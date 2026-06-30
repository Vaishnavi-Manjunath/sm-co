<?php
// ============================================================
//  IDNUK SOFTWARE - API Helpers
// ============================================================

$_dbCfg = $_SERVER['DOCUMENT_ROOT'] . '/config/database.php';
if (!file_exists($_dbCfg)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'Server not configured yet. Please upload config/database.php.']);
    exit();
}
require_once $_dbCfg;
require_once __DIR__ . '/sentry.php';
sentry_init();   // inert unless SENTRY_DSN_PHP is configured

// ---- CORS & Headers ----
// Same-origin requests don't need CORS at all; we only echo the Origin back when it
// matches our own host (or localhost for dev), so third-party websites can't call the
// API from a visitor's browser.
header('Content-Type: application/json; charset=utf-8');
$reqOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($reqOrigin) {
    $originHost = parse_url($reqOrigin, PHP_URL_HOST) ?: '';
    $selfHost   = explode(':', $_SERVER['HTTP_HOST'] ?? '')[0];
    if ($originHost !== '' && ($originHost === $selfHost || in_array($originHost, ['localhost', '127.0.0.1'], true))) {
        header("Access-Control-Allow-Origin: $reqOrigin");
        header('Vary: Origin');
    }
}
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

// ---- Security headers ----
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');                       // block click-jacking
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Strict-Transport-Security: max-age=31536000'); // force HTTPS for a year

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ---- Response helpers ----
function respond(mixed $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit();
}

function respondError(string $message, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit();
}

// 500s: log the real exception (server log + Sentry) but never leak internals to the client.
function respondServerError(string $context, Throwable $e): never {
    error_log("IDNUK [$context] " . $e->getMessage());
    try { sentry_capture($e); } catch (Throwable $x) { /* logging must never break the response */ }
    respondError("$context failed. The error has been logged — please try again or contact the admin.", 500);
}

// ---- One-time schema migrations ----
// Each endpoint used to run its CREATE TABLE / ALTER TABLE statements on EVERY request
// (the ALTERs throwing+catching an exception each time). migrateOnce() runs a file's DDL
// block only until its version number is recorded in app_settings, then skips it —
// one cached lookup per request instead of a dozen DDL statements.
// To add new DDL later: put it inside the same block and bump that file's version number.
function migrateOnce(string $key, int $version, callable $fn): void {
    static $vers = null;
    $db = getDB();
    if ($vers === null) {
        try { $vers = $db->query("SELECT skey, sval FROM app_settings WHERE skey LIKE 'schemav\\_%'")->fetchAll(PDO::FETCH_KEY_PAIR) ?: []; }
        catch (Throwable $e) { $vers = []; }   // app_settings missing → run everything
    }
    if ((int)($vers["schemav_$key"] ?? 0) >= $version) return;
    $ok = true;
    try { $fn($db); } catch (Throwable $e) { $ok = false; error_log("IDNUK migrate[$key v$version] " . $e->getMessage()); }
    if (!$ok) return;   // don't mark — retry next request
    try {
        $db->exec("CREATE TABLE IF NOT EXISTS app_settings (
            skey VARCHAR(50) PRIMARY KEY, sval MEDIUMTEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        $db->prepare("INSERT INTO app_settings (skey, sval) VALUES (?,?)
                      ON DUPLICATE KEY UPDATE sval=VALUES(sval)")->execute(["schemav_$key", (string)$version]);
        $vers["schemav_$key"] = (string)$version;
    } catch (Throwable $e) { /* best effort */ }
}

function respondList(array $rows, int $total = -1): never {
    http_response_code(200);
    echo json_encode([
        'success' => true,
        'data'    => $rows,
        'total'   => $total < 0 ? count($rows) : $total
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- Input helpers ----
function getBody(): array {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?? [];
}

function getParam(string $key, mixed $default = null): mixed {
    return $_GET[$key] ?? $default;
}

// ---- Auth (simple session token) ----
function requireAuth(): array {
    $token = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $token = str_replace('Bearer ', '', $token);
    if (empty($token)) respondError('Unauthorized', 401);

    $db = getDB();
    $stmt = $db->prepare("
        SELECT u.id, u.username, u.full_name, u.role, u.permissions
        FROM user_sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > NOW() AND u.is_active = 1
    ");
    $stmt->execute([$token]);
    $user = $stmt->fetch();
    if (!$user) respondError('Session expired. Please login again.', 401);

    // Sliding session: keep an active user logged in by rolling the 8-hour
    // window forward on each request. Only writes when the window has less than
    // ~7h45m left, so this is at most one cheap UPDATE every 15 minutes.
    $db->prepare("UPDATE user_sessions SET expires_at = DATE_ADD(NOW(), INTERVAL 8 HOUR)
                  WHERE token = ? AND expires_at < DATE_ADD(NOW(), INTERVAL 465 MINUTE)")
       ->execute([$token]);

    $user['permissions'] = json_decode($user['permissions'] ?? '[]', true) ?: [];
    $GLOBALS['__audit_user'] = $user;   // available to auditLog()
    ensureAuditTable();                 // create the trail table once, before any transaction starts
    ensureDayLockTable();               // create the day-lock table once, before any transaction starts
    enforceModuleWrite($user);          // staff module permissions apply to the API too, not just the sidebar
    return $user;
}

// ---- Server-side module permissions ----
// Staff permissions used to be enforced only by the sidebar (the API accepted any
// authenticated token). Writes (POST/PUT/DELETE) now require one of the modules that
// legitimately use this endpoint. Reads stay open to any logged-in user because the
// billing screens cross-load reference data (parties, products, rates...).
function enforceModuleWrite(array $user): void {
    if (($user['role'] ?? '') === 'admin') return;
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'GET' || $method === 'OPTIONS' || $method === 'HEAD') return;
    $file = basename($_SERVER['SCRIPT_NAME'] ?? '');
    // endpoint file → modules whose screens write through it
    $MAP = [
        'purchase.php' => ['purchase', 'payments', 'tally', 'yard'],
        'sales.php'    => ['sales', 'payments', 'tally'],
        'yard.php'     => ['yard', 'purchase', 'sales'],
        'market.php'   => ['market', 'tally'],
        'parties.php'  => ['parties', 'purchase', 'sales', 'yard', 'market'],
        'products.php' => ['products', 'purchase', 'sales'],
        'reports.php'  => ['expenses', 'reports', 'tally'],
        'settings.php' => ['print', 'tally'],
    ];
    if (!isset($MAP[$file])) return;   // other endpoints carry their own admin-only checks
    $perms = is_array($user['permissions'] ?? null) ? $user['permissions'] : [];
    foreach ($MAP[$file] as $m) if (in_array($m, $perms, true)) return;
    respondError('Your account does not have permission for this action.', 403);
}

// ---- Audit trail (append-only change log) ----
// Ensured once per request, OUTSIDE any transaction (CREATE TABLE implicitly commits).
function ensureAuditTable(): void {
    static $done = false;
    if ($done) return;
    $done = true;
    migrateOnce('audit', 1, function ($db) {
        $db->exec("CREATE TABLE IF NOT EXISTS audit_log (
            id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            ts        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            user_id   INT UNSIGNED NULL,
            username  VARCHAR(50) NULL,
            action    VARCHAR(20) NOT NULL,
            entity    VARCHAR(40) NOT NULL,
            entity_id VARCHAR(40) NULL,
            label     VARCHAR(200) NULL,
            details   TEXT NULL,
            ip        VARCHAR(45) NULL,
            INDEX idx_ts (ts),
            INDEX idx_entity (entity, entity_id),
            INDEX idx_user (user_id)
        )");
    });
}

// Record one change. Safe to call inside a transaction (the row commits/rolls back with it).
// $details may be an array (json-encoded) or string. Never throws — logging must not break the op.
function auditLog(string $action, string $entity, $entityId = null, ?string $label = null, $details = null): void {
    try {
        $db   = getDB();
        $user = $GLOBALS['__audit_user'] ?? null;
        // Write ts from PHP so it lines up with the PHP-side date filters in audit.php (avoids any DB/PHP timezone skew).
        $db->prepare("INSERT INTO audit_log (ts, user_id, username, action, entity, entity_id, label, details, ip)
                      VALUES (?,?,?,?,?,?,?,?,?)")
           ->execute([
               date('Y-m-d H:i:s'),
               $user['id'] ?? null,
               $user['username'] ?? null,
               $action, $entity,
               $entityId !== null ? (string)$entityId : null,
               $label !== null ? mb_substr($label, 0, 200) : null,
               $details === null ? null : (is_string($details) ? $details : json_encode($details, JSON_UNESCAPED_UNICODE)),
               $_SERVER['REMOTE_ADDR'] ?? null,
           ]);
    } catch (Throwable $e) { /* never break the main operation because of logging */ }
}

// ---- Day lock (freeze a finished business day) ----
// The day_locks table holds one row per locked DATE. While a date is locked,
// nothing dated to that day may be created/edited/deleted (enforced via
// assertDateUnlocked at every dated write). Ensured once per request, OUTSIDE
// any transaction (CREATE TABLE implicitly commits).
function ensureDayLockTable(): void {
    static $done = false;
    if ($done) return;
    $done = true;
    migrateOnce('daylock', 1, function ($db) {
        $db->exec("CREATE TABLE IF NOT EXISTS day_locks (
            lock_date  DATE PRIMARY KEY,
            locked_by  VARCHAR(50) NULL,
            locked_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            note       VARCHAR(255) NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    });
}

// True if the given Y-m-d date is locked. Result cached per request.
function isDayLocked(?string $date): bool {
    if (!$date) return false;
    static $cache = [];
    if (array_key_exists($date, $cache)) return $cache[$date];
    try {
        $st = getDB()->prepare("SELECT 1 FROM day_locks WHERE lock_date = ?");
        $st->execute([$date]);
        $cache[$date] = (bool)$st->fetch();
    } catch (Throwable $e) { $cache[$date] = false; }
    return $cache[$date];
}

// Reject (HTTP 423 Locked) any write dated to a locked day. Pass one or more
// dates (e.g. the old and new date when editing) — locked if ANY is locked.
function assertDateUnlocked(?string ...$dates): void {
    foreach ($dates as $d) {
        if (isDayLocked($d)) {
            respondError("Day $d is locked. Ask an admin to unlock it before making changes.", 423);
        }
    }
}

// The current working/business date that new entries default to (set in the
// Day bar). Falls back to today when unset or invalid.
function businessDate(): string {
    static $cached = null;
    if ($cached !== null) return $cached;
    $today = date('Y-m-d');
    try {
        $st = getDB()->prepare("SELECT sval FROM app_settings WHERE skey = 'business_date'");
        $st->execute();
        $row = $st->fetch();
        $d = $row ? trim((string)$row['sval']) : '';
        $cached = (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) ? $d : $today;
    } catch (Throwable $e) { $cached = $today; }
    return $cached;
}

// ---- Business rules (admin-configurable; defaults match Sri Murugan & Co's practice) ----
function defaultBusinessRules(): array {
    return [
        'commission_pct'   => 10,   // default commission % on purchase bills
        'credit_days'      => 14,   // default vendor credit days on sales bills
        'freight_per_kg'   => 0.5,  // yard auto freight = net weight × this
        'coolie_bag_zero'  => 5,    // coolie ₹/bag for bag-priced items (no weighing)
        'coolie_bag_small' => 3,    // coolie ₹/bag up to coolie_small_max kg
        'coolie_bag_large' => 5,    // coolie ₹/bag above coolie_small_max kg
        'coolie_small_max' => 30,   // slab boundary (kg)
    ];
}
function businessRules(): array {
    static $cached = null;
    if ($cached !== null) return $cached;
    $d = defaultBusinessRules();
    try {
        $st = getDB()->prepare("SELECT sval FROM app_settings WHERE skey = 'business_rules'");
        $st->execute();
        $row = $st->fetch();
        $saved = $row ? (json_decode($row['sval'], true) ?: []) : [];
        foreach ($d as $k => $v) if (isset($saved[$k]) && is_numeric($saved[$k])) $d[$k] = (float)$saved[$k];
    } catch (Throwable $e) {}
    return $cached = $d;
}

// ---- WhatsApp / sharing helpers ----
// Normalise an Indian phone number for wa.me links: '91' + last 10 digits, or '' if unusable.
function waPhone(?string $raw): string {
    $d = preg_replace('/\D/', '', (string)$raw);
    return strlen($d) >= 10 ? '91' . substr($d, -10) : '';
}

// Company letterhead values (from the editable print template), with the standard fallbacks.
function companyTpl(PDO $db): array {
    $tpl = [];
    try {
        $st = $db->prepare("SELECT sval FROM app_settings WHERE skey = 'print_template'");
        $st->execute();
        $row = $st->fetch();
        $tpl = $row ? (json_decode($row['sval'], true) ?: []) : [];
    } catch (Throwable $e) {}
    return [
        'company_ta' => $tpl['company_ta'] ?? 'ஸ்ரீ முருகன் அன் கோ.,',
        'company_en' => $tpl['company_en'] ?? 'SRI MURUGAN & Co.,',
        'address'    => $tpl['address']    ?? '',
        'phone'      => $tpl['phone']      ?? '',
        'greeting'   => $tpl['greeting_left'] ?? 'வாணிபமே கோயில் !',
    ];
}

// Absolute base URL of this deployment (for share links).
function baseUrl(): string {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

// ---- Bill number generator (Indian financial year: Apr 1 – Mar 31) ----
// Numbers restart from 1 every April 1. The FY is derived from the BILL's date (not
// today), so a March 31 bill entered on April 1 morning still gets the old year's
// sequence — which matters with the Day Lock back-dating workflow.
// Format: PUR-2026-27-00001.
function nextBillNo(string $prefix, ?string $date = null): string {
    $db = getDB();
    $d  = ($date && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) ? $date : businessDate();
    $y  = (int)substr($d, 0, 4);
    $fyStart = ((int)substr($d, 5, 2)) >= 4 ? $y : $y - 1;
    $label   = $fyStart . '-' . substr((string)($fyStart + 1), 2);   // e.g. 2026-27
    $key     = "$prefix-FY$fyStart";

    // One-time seed: when switching to FY numbering mid-year, continue from the old
    // calendar-year sequence instead of restarting at 1 (only April 1 resets).
    static $seeded = [];
    if (empty($seeded[$key])) {
        $seeded[$key] = true;
        try {
            $old = $db->prepare("SELECT last_no FROM bill_sequences WHERE seq_key = ?");
            $old->execute(["$prefix-$fyStart"]);
            $n = (int)$old->fetchColumn();
            if ($n > 0) $db->prepare("INSERT IGNORE INTO bill_sequences (seq_key, last_no) VALUES (?,?)")->execute([$key, $n]);
        } catch (Throwable $e) { /* best effort */ }
    }

    // Atomic: LAST_INSERT_ID(expr) pins the incremented value to THIS connection, so two
    // clerks saving at the same moment can never read the same number.
    $db->prepare("INSERT INTO bill_sequences (seq_key, last_no) VALUES (?, LAST_INSERT_ID(1))
                  ON DUPLICATE KEY UPDATE last_no = LAST_INSERT_ID(last_no + 1)")->execute([$key]);
    $n = (int)$db->query("SELECT LAST_INSERT_ID()")->fetchColumn();

    return "$prefix-$label-" . str_pad((string)$n, 5, '0', STR_PAD_LEFT);
}

// ---- Base schema — creates all core tables on a fresh install.
// Runs on the first request to ANY endpoint (api.php is always included first).
// Every statement uses CREATE TABLE IF NOT EXISTS so it is safe to run on
// existing databases — it simply skips tables that already exist.
migrateOnce('base', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS party_categories (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        code       VARCHAR(30)  NOT NULL UNIQUE,
        name_en    VARCHAR(100) NOT NULL,
        name_ta    VARCHAR(100) NULL,
        sort_order INT DEFAULT 0,
        is_active  TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS cities (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name_en    VARCHAR(100) NOT NULL,
        name_ta    VARCHAR(100) NULL,
        state      VARCHAR(50)  NULL,
        sort_order INT DEFAULT 0,
        is_active  TINYINT(1) DEFAULT 1,
        UNIQUE KEY uniq_name (name_en)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS parties (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        code             VARCHAR(20)  NOT NULL UNIQUE,
        name_en          VARCHAR(200) NOT NULL,
        name_ta          VARCHAR(200) NULL,
        category_id      INT UNSIGNED NOT NULL,
        reference_id     INT UNSIGNED NULL,
        city_id          INT UNSIGNED NULL,
        phone1           VARCHAR(20)  NULL,
        phone2           VARCHAR(20)  NULL,
        address          TEXT         NULL,
        city             VARCHAR(100) NULL,
        area             VARCHAR(100) NULL,
        pincode          VARCHAR(10)  NULL,
        gstin            VARCHAR(20)  NULL,
        credit_days      INT DEFAULT 14,
        credit_limit     DECIMAL(12,2) DEFAULT 0,
        opening_balance  DECIMAL(12,2) DEFAULT 0,
        opening_bal_type ENUM('dr','cr') DEFAULT 'cr',
        commission_pct   DECIMAL(5,2) DEFAULT 10,
        is_active        TINYINT(1) DEFAULT 1,
        notes            TEXT NULL,
        legacy_code      VARCHAR(30)  NULL,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_category (category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS party_truck_links (
        farmer_id INT UNSIGNED NOT NULL,
        truck_id  INT UNSIGNED NOT NULL,
        PRIMARY KEY (farmer_id, truck_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS product_categories (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name_en    VARCHAR(100) NOT NULL,
        name_ta    VARCHAR(100) NULL,
        sort_order INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS products (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        code             VARCHAR(20)  NOT NULL UNIQUE,
        name_en          VARCHAR(150) NOT NULL,
        name_ta          VARCHAR(150) NULL,
        unit_type        ENUM('KG','BAG') DEFAULT 'KG',
        category_id      INT UNSIGNED NULL,
        bag_deduction_kg DECIMAL(6,2) DEFAULT 3,
        vendor_short_kg  DECIMAL(6,2) DEFAULT 0,
        is_active        TINYINT(1) DEFAULT 1,
        sort_order       INT DEFAULT 0,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS bill_sequences (
        seq_key VARCHAR(40) PRIMARY KEY,
        last_no INT UNSIGNED DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $db->exec("CREATE TABLE IF NOT EXISTS purchase_bills (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        bill_no          VARCHAR(30)  NULL,
        bill_date        DATE         NOT NULL,
        bill_time        TIME         NULL,
        party_id         INT UNSIGNED NOT NULL,
        party_type       VARCHAR(20)  DEFAULT 'FARMER',
        lorry_party_id   INT UNSIGNED NULL,
        lorry_no         VARCHAR(30)  NULL,
        lorry_freight    DECIMAL(10,2) DEFAULT 0,
        commission_pct   DECIMAL(5,2)  DEFAULT 10,
        subtotal_weight  DECIMAL(12,2) DEFAULT 0,
        subtotal_amount  DECIMAL(12,2) DEFAULT 0,
        total_commission DECIMAL(12,2) DEFAULT 0,
        total_sakku_amt  DECIMAL(12,2) DEFAULT 0,
        total_cooly_amt  DECIMAL(12,2) DEFAULT 0,
        total_sungam_amt DECIMAL(12,2) DEFAULT 0,
        total_advance    DECIMAL(12,2) DEFAULT 0,
        other_deductions DECIMAL(12,2) DEFAULT 0,
        net_payable      DECIMAL(12,2) DEFAULT 0,
        payment_status   VARCHAR(20)  DEFAULT 'unpaid',
        payment_mode     VARCHAR(20)  DEFAULT 'cash',
        payment_ref      VARCHAR(100) NULL,
        reference_name   VARCHAR(100) NULL,
        share_token      VARCHAR(40)  NULL,
        print_count      INT NOT NULL DEFAULT 0,
        last_printed_at  DATETIME NULL,
        is_cancelled     TINYINT(1) DEFAULT 0,
        notes            TEXT NULL,
        created_by       INT UNSIGNED NULL,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date   (bill_date),
        INDEX idx_party  (party_id),
        UNIQUE KEY idx_share (share_token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS purchase_items (
        id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        bill_id        INT UNSIGNED NOT NULL,
        product_id     INT UNSIGNED NOT NULL,
        actual_weight  DECIMAL(12,2) DEFAULT 0,
        bag_deduction  DECIMAL(12,2) DEFAULT 0,
        billed_weight  DECIMAL(12,2) DEFAULT 0,
        no_of_bags     INT DEFAULT 0,
        unit_type      VARCHAR(10) DEFAULT 'KG',
        purchase_rate  DECIMAL(10,2) DEFAULT 0,
        gross_amount   DECIMAL(12,2) DEFAULT 0,
        commission_pct DECIMAL(5,2)  DEFAULT 0,
        commission_amt DECIMAL(12,2) DEFAULT 0,
        sakku_qty      INT DEFAULT 0,
        sakku_rate     DECIMAL(10,2) DEFAULT 0,
        sakku_amt      DECIMAL(12,2) DEFAULT 0,
        cooly_amt      DECIMAL(12,2) DEFAULT 0,
        sungam_amt     DECIMAL(12,2) DEFAULT 0,
        net_amount     DECIMAL(12,2) DEFAULT 0,
        notes          TEXT NULL,
        weights_detail VARCHAR(255) NULL,
        damage_kg      DECIMAL(10,2) DEFAULT 0,
        INDEX idx_bill    (bill_id),
        INDEX idx_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS sales_bills (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        bill_no         VARCHAR(30)  NULL,
        bill_date       DATE         NOT NULL,
        bill_time       TIME         NULL,
        party_id        INT UNSIGNED NOT NULL,
        salesman        VARCHAR(100) NULL,
        credit_days     INT DEFAULT 0,
        due_date        DATE         NULL,
        subtotal_weight DECIMAL(12,2) DEFAULT 0,
        subtotal_amount DECIMAL(12,2) DEFAULT 0,
        discount_pct    DECIMAL(5,2)  DEFAULT 0,
        discount_amt    DECIMAL(12,2) DEFAULT 0,
        total_sakku_amt DECIMAL(12,2) DEFAULT 0,
        total_cooly_amt DECIMAL(12,2) DEFAULT 0,
        net_amount      DECIMAL(12,2) DEFAULT 0,
        paid_amount     DECIMAL(12,2) DEFAULT 0,
        balance_due     DECIMAL(12,2) DEFAULT 0,
        credited_amt    DECIMAL(12,2) DEFAULT 0,
        opening_balance DECIMAL(12,2) DEFAULT 0,
        payment_status  VARCHAR(20)  DEFAULT 'unpaid',
        share_token     VARCHAR(40)  NULL,
        print_count     INT NOT NULL DEFAULT 0,
        last_printed_at DATETIME NULL,
        is_cancelled    TINYINT(1) DEFAULT 0,
        notes           TEXT NULL,
        created_by      INT UNSIGNED NULL,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_party  (party_id),
        INDEX idx_date   (bill_date),
        INDEX idx_bal    (is_cancelled, balance_due),
        UNIQUE KEY idx_share (share_token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS sales_items (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        bill_id          INT UNSIGNED NOT NULL,
        purchase_item_id INT UNSIGNED NULL,
        product_id       INT UNSIGNED NULL,
        no_of_bags       INT DEFAULT 0,
        vendor_weight    DECIMAL(12,2) DEFAULT 0,
        purchase_weight  DECIMAL(12,2) DEFAULT 0,
        weight_profit    DECIMAL(12,2) DEFAULT 0,
        unit_type        VARCHAR(10) DEFAULT 'KG',
        purchase_rate    DECIMAL(10,2) DEFAULT 0,
        sale_rate        DECIMAL(10,2) DEFAULT 0,
        gross_amount     DECIMAL(12,2) DEFAULT 0,
        discount_pct     DECIMAL(5,2)  DEFAULT 0,
        discount_amt     DECIMAL(12,2) DEFAULT 0,
        sakku_qty        INT DEFAULT 0,
        sakku_rate       DECIMAL(10,2) DEFAULT 0,
        sakku_amt        DECIMAL(12,2) DEFAULT 0,
        cooly_amt        DECIMAL(12,2) DEFAULT 0,
        net_amount       DECIMAL(12,2) DEFAULT 0,
        margin_amount    DECIMAL(12,2) DEFAULT 0,
        notes            TEXT NULL,
        INDEX idx_bill (bill_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS payments_received (
        id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        receipt_no   VARCHAR(30)  NULL,
        party_id     INT UNSIGNED NOT NULL,
        receipt_date DATE         NOT NULL,
        amount       DECIMAL(12,2) DEFAULT 0,
        discount_amt DECIMAL(12,2) DEFAULT 0,
        payment_mode VARCHAR(20) DEFAULT 'cash',
        bank_name    VARCHAR(80)  NULL,
        payment_ref  VARCHAR(100) NULL,
        notes        TEXT NULL,
        created_by   INT UNSIGNED NULL,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_party (party_id),
        INDEX idx_date  (receipt_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS payment_allocations (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        payment_id INT UNSIGNED NOT NULL,
        bill_id    INT UNSIGNED NOT NULL,
        amount     DECIMAL(12,2) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_payment (payment_id),
        INDEX idx_bill    (bill_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS ledger (
        id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        txn_date    DATE        NOT NULL,
        txn_type    VARCHAR(30) NOT NULL,
        ref_type    VARCHAR(30) NULL,
        ref_id      INT UNSIGNED NULL,
        party_id    INT UNSIGNED NULL,
        description VARCHAR(255) NULL,
        debit       DECIMAL(12,2) DEFAULT 0,
        credit      DECIMAL(12,2) DEFAULT 0,
        created_by  INT UNSIGNED NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_party_date (party_id, txn_date),
        INDEX idx_type       (txn_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS daily_expenses (
        id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        expense_date DATE         NOT NULL,
        category     VARCHAR(60)  DEFAULT 'General',
        description  VARCHAR(255) NULL,
        amount       DECIMAL(12,2) DEFAULT 0,
        payment_mode VARCHAR(20) DEFAULT 'cash',
        bank_name    VARCHAR(80)  NULL,
        payment_ref  VARCHAR(100) NULL,
        created_by   INT UNSIGNED NULL,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (expense_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS daily_rates (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        rate_date   DATE         NOT NULL,
        product_id  INT UNSIGNED NOT NULL,
        market_rate DECIMAL(10,2) DEFAULT 0,
        min_rate    DECIMAL(10,2) DEFAULT 0,
        max_rate    DECIMAL(10,2) DEFAULT 0,
        notes       VARCHAR(255) NULL,
        created_by  INT UNSIGNED NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_date_product (rate_date, product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS tally_exports (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        export_type VARCHAR(30) DEFAULT 'xml',
        from_date   DATE        NOT NULL,
        to_date     DATE        NOT NULL,
        filename    VARCHAR(255) NULL,
        created_by  INT UNSIGNED NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Seed default party categories
    $ins = $db->prepare("INSERT IGNORE INTO party_categories (code, name_en, sort_order) VALUES (?,?,?)");
    foreach ([
        ['FARMER',        'Farmer',          1],
        ['SUPPLIER',      'Supplier',        2],
        ['MARKET_VENDOR', 'Market Vendor',   3],
        ['CUSTOMER',      'Customer',        4],
        ['OVERFLOW',      'Overflow Vendor', 5],
        ['TRUCK',         'Truck/Reference', 6],
        ['ORDER_SUPPLIER','Order Supplier',  7],
    ] as [$code, $en, $sort]) {
        $ins->execute([$code, $en, $sort]);
    }
});
