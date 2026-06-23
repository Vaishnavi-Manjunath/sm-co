<?php
// ============================================================
//  IDNUK SOFTWARE - PUBLIC endpoints (NO LOGIN)
//  Used only by the marketing homepage. This file is the public
//  boundary: it can ONLY read the published rates and write an
//  enquiry. It never touches bills, customers, ledger, or any
//  private table. Do NOT add authenticated/data actions here.
//
//  GET  /api/public?action=rates    - today's published rates + contact
//  POST /api/public?action=enquiry  - capture a new-customer enquiry
// ============================================================
require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';   // helpers only — requireAuth() is NOT called

$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'rates');
$db     = getDB();

migrateOnce('public_site', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS app_settings (
        skey VARCHAR(50) PRIMARY KEY, sval MEDIUMTEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $db->exec("CREATE TABLE IF NOT EXISTS enquiries (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        name       VARCHAR(120) NOT NULL,
        phone      VARCHAR(30)  NOT NULL,
        message    TEXT NULL,
        status     VARCHAR(20) DEFAULT 'new',
        ip         VARCHAR(45) NULL,
        INDEX idx_created (created_at),
        INDEX idx_status (status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
});

function settingJson(PDO $db, string $key) {
    $st = $db->prepare("SELECT sval FROM app_settings WHERE skey = ?");
    $st->execute([$key]);
    $row = $st->fetch();
    $v = $row ? json_decode($row['sval'], true) : null;
    return is_array($v) ? $v : null;
}

// ---- GET: published rates + public contact details (read-only) ----
if ($method === 'GET' && $action === 'rates') {
    $rates = settingJson($db, 'public_rates') ?? ['as_of' => null, 'items' => []];
    // Pull a few display fields from the print template so the page shows real contact info
    $tpl = settingJson($db, 'print_template') ?? [];
    $contact = [
        'company_en' => $tpl['company_en'] ?? 'Sri Murugan & Co.,',
        'company_ta' => $tpl['company_ta'] ?? '',
        'address'    => $tpl['address']    ?? '',
        'address_ta' => $tpl['address_ta'] ?? '',
        'phone'      => $tpl['phone']      ?? '',
    ];
    // app_logo is stored as a raw data-URL string (not JSON)
    $lg = $db->query("SELECT sval FROM app_settings WHERE skey='app_logo'")->fetch();
    $contact['logo'] = $lg ? (string)$lg['sval'] : '';
    respond(['rates' => $rates, 'contact' => $contact]);
}

// ---- POST: capture an enquiry from a prospective customer ----
if ($method === 'POST' && $action === 'enquiry') {
    $b = getBody();
    // Honeypot: real users never fill the hidden "company" field — silently accept & drop bots
    if (!empty($b['company'])) respond(['ok' => true]);

    $name    = trim((string)($b['name']    ?? ''));
    $phone   = trim((string)($b['phone']   ?? ''));
    $message = trim((string)($b['message'] ?? ''));
    if ($name === '' || $phone === '') respondError('Please enter your name and phone number.');
    if (mb_strlen($name) > 120 || mb_strlen($phone) > 30 || mb_strlen($message) > 1000) {
        respondError('That input is too long.');
    }
    if (!preg_match('/[0-9]{6,}/', preg_replace('/\s+/', '', $phone))) {
        respondError('Please enter a valid phone number.');
    }

    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    // Light rate limit: at most 5 enquiries per IP per hour
    $rl = $db->prepare("SELECT COUNT(*) FROM enquiries WHERE ip = ? AND created_at > (NOW() - INTERVAL 1 HOUR)");
    $rl->execute([$ip]);
    if ((int)$rl->fetchColumn() >= 5) respondError('Too many messages from here. Please try again later.', 429);

    $db->prepare("INSERT INTO enquiries (name, phone, message, ip) VALUES (?,?,?,?)")
       ->execute([$name, $phone, $message, $ip]);
    respond(['ok' => true]);
}

respondError('Invalid action', 400);
