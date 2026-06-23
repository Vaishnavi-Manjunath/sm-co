<?php
// ============================================================
//  IDNUK SOFTWARE - App Settings API
//  GET  /api/settings?action=print        - get print template
//  POST /api/settings?action=print-save   - save print template
// ============================================================
require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'print');
$db     = getDB();

// Key-value settings store (logo stored as base64 data URL inside the JSON)
migrateOnce('app_settings', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS app_settings (
        skey       VARCHAR(50) PRIMARY KEY,
        sval       MEDIUMTEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
});

function defaultPrintTemplate(): array {
    return [
        'company_en'     => 'SRI MURUGAN & Co.,',
        'company_ta'     => 'ஸ்ரீ முருகன் அன் கோ.,',
        'subtitle_en'    => 'Vegetable Commission Agent & Order Suppliers',
        'subtitle_ta'    => 'காய்கறி கமிஷன் ஏஜென்ட் & ஆர்டர் சப்ளையர்ஸ்',
        'address'        => '94, 95, Gandhi Market, Thangachiammapatti, ODDANCHATRAM - 624 612.',
        'address_ta'     => '94, 95, காந்தி மார்க்கெட், தங்கச்சியம்மாபட்டி, ஒட்டன்சத்திரம்.',
        'phone'          => 'Cell : 94433 34663, 73733 99999',
        'greeting_left'  => 'வாணிபமே கோயில் !',
        'greeting_right' => 'வாடிக்கையாளரே தெய்வம் !!',
        'footer'         => 'என்றும் தங்கள் நல்வரவை விரும்பும் (S.M. & CO.,)',
        'logo'           => '',
        'data_only_top_mm' => 40,
        // ----- Pre-printed A5 stationery (values-only overlay) -----
        'print_format'      => 'full',   // 'full' (A5 software letterhead) | 'preprinted' (A5 overlay) | 'thermal' (80mm roll)
        'pre_top_mm'        => 40,        // space above the customer line (move everything down/up)
        'pre_left_mm'       => 6,         // shift everything right/left
        'pre_label_indent_mm' => 16,      // where the Name/Place values start (clear the printed labels)
        'pre_items_gap_mm'  => 16,        // gap from the customer line to the first item row
        'pre_row_mm'        => 7.5,       // height of each item row (line spacing)
        'pre_totals_gap_mm' => 55,        // gap from last item to the Bill Total line
        'pre_font_pt'       => 12,        // text size on the pre-printed bill
        // Pre-printed 6x6 PURCHASE bill — nudge knobs (values-only overlay)
        'pre_pur_top_mm'    => 0,         // move the whole purchase overlay down(+)/up(-)
        'pre_pur_left_mm'   => 0,         // move the whole purchase overlay right(+)/left(-)
        'pre_pur_row_mm'    => 6.6,       // spacing between cooli/vadakai/rokkam/commission lines
    ];
}

// ---- GET: business rules (coolie slabs, freight rate, commission, credit days) ----
if ($method === 'GET' && $action === 'rules') {
    respond(businessRules());
}

// ---- POST: save business rules (admin only) ----
if ($method === 'POST' && $action === 'rules-save') {
    if (($user['role'] ?? '') !== 'admin') respondError('Admins only.', 403);
    $b = getBody();
    $clean = [];
    foreach (defaultBusinessRules() as $k => $dflt) {
        $v = $b[$k] ?? $dflt;
        if (!is_numeric($v) || (float)$v < 0) respondError("Invalid value for $k");
        $clean[$k] = (float)$v;
    }
    if ($clean['commission_pct'] > 50) respondError('Commission % looks wrong (max 50)');
    $db->prepare("INSERT INTO app_settings (skey, sval) VALUES ('business_rules', ?)
                  ON DUPLICATE KEY UPDATE sval = VALUES(sval)")
       ->execute([json_encode($clean)]);
    auditLog('UPDATE', 'settings', 'business_rules', 'Saved business rules', $clean);
    respond(['action' => 'saved'] + $clean);
}

// ---- GET: print template ----
if ($method === 'GET' && $action === 'print') {
    $stmt = $db->prepare("SELECT sval FROM app_settings WHERE skey = 'print_template'");
    $stmt->execute();
    $row = $stmt->fetch();
    $saved = $row ? json_decode($row['sval'], true) : null;
    // Merge saved over defaults so new fields always have a value
    respond(array_merge(defaultPrintTemplate(), is_array($saved) ? $saved : []));
}

// ---- POST: save print template ----
if ($method === 'POST' && $action === 'print-save') {
    $b = getBody();
    if (!is_array($b)) respondError('Invalid template');
    // Keep only known keys; clamp logo size to avoid runaway payloads (~1.5MB base64)
    $tpl = array_merge(defaultPrintTemplate(), $b);
    if (isset($tpl['logo']) && strlen($tpl['logo']) > 2000000) respondError('Logo image too large (max ~1.5MB)');
    $json = json_encode($tpl, JSON_UNESCAPED_UNICODE);
    $db->prepare("INSERT INTO app_settings (skey, sval) VALUES ('print_template', ?)
                  ON DUPLICATE KEY UPDATE sval = VALUES(sval)")->execute([$json]);
    auditLog('UPDATE', 'settings', 'print_template', "Saved print template", ['format' => $tpl['print_format'] ?? null]);
    respond(['action' => 'saved']);
}

// ---- GET: opening cash/bank balance config ----
if ($method === 'GET' && $action === 'opening') {
    $stmt = $db->prepare("SELECT sval FROM app_settings WHERE skey = 'opening_balance'");
    $stmt->execute();
    $row = $stmt->fetch();
    $val = $row ? json_decode($row['sval'], true) : null;
    respond(is_array($val) ? $val : ['as_of' => '2000-01-01', 'cash' => 0, 'banks' => []]);
}

// ---- POST: save opening cash/bank balance config ----
if ($method === 'POST' && $action === 'opening-save') {
    $b = getBody();
    $val = [
        'as_of' => $b['as_of'] ?? date('Y-m-d'),
        'cash'  => (float)($b['cash'] ?? 0),
        'banks' => array_values(array_filter(array_map(function ($x) {
            return ['name' => trim($x['name'] ?? ''), 'amount' => (float)($x['amount'] ?? 0)];
        }, $b['banks'] ?? []), fn($x) => $x['name'] !== '')),
    ];
    $db->prepare("INSERT INTO app_settings (skey, sval) VALUES ('opening_balance', ?)
                  ON DUPLICATE KEY UPDATE sval = VALUES(sval)")->execute([json_encode($val, JSON_UNESCAPED_UNICODE)]);
    auditLog('UPDATE', 'settings', 'opening_balance', "Saved opening balance", ['as_of' => $val['as_of'], 'cash' => $val['cash']]);
    respond(['action' => 'saved']);
}

// ---- GET: app/brand logo (shown in the sidebar & login) ----
if ($method === 'GET' && $action === 'app-logo') {
    $stmt = $db->prepare("SELECT sval FROM app_settings WHERE skey = 'app_logo'");
    $stmt->execute();
    $row = $stmt->fetch();
    respond(['logo' => $row ? (string)$row['sval'] : '']);
}

// ---- POST: save app/brand logo (base64 data URL, or '' to clear) — admin only ----
if ($method === 'POST' && $action === 'app-logo-save') {
    if (($user['role'] ?? '') !== 'admin') respondError('Admins only.', 403);
    $b = getBody();
    $logo = (string)($b['logo'] ?? '');
    if (strlen($logo) > 2000000) respondError('Logo image too large (max ~1.5MB)');
    if ($logo !== '' && !preg_match('#^data:image/#', $logo)) respondError('Logo must be an image');
    $db->prepare("INSERT INTO app_settings (skey, sval) VALUES ('app_logo', ?)
                  ON DUPLICATE KEY UPDATE sval = VALUES(sval)")->execute([$logo]);
    auditLog('UPDATE', 'settings', 'app_logo', $logo === '' ? 'Cleared brand logo' : 'Updated brand logo', ['has_logo' => $logo !== '']);
    respond(['action' => 'saved', 'has_logo' => $logo !== '']);
}

respondError('Invalid action', 400);
