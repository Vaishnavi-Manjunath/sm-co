<?php
// ============================================================
//  IDNUK SOFTWARE - Marketing / Website admin API (LOGIN required)
//  Admin curates which rates appear on the public homepage and
//  reads the enquiries that come in from it.
//
//  GET  /api/marketing?action=get-rates      - current published rates
//  POST /api/marketing?action=save-rates     - publish a curated rate list (admin)
//  GET  /api/marketing?action=enquiries      - list website enquiries
//  POST /api/marketing?action=enquiry-status - mark contacted / delete (admin)
// ============================================================
require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'get-rates');
$db     = getDB();

migrateOnce('public_site', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS app_settings (
        skey VARCHAR(50) PRIMARY KEY, sval MEDIUMTEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $db->exec("CREATE TABLE IF NOT EXISTS enquiries (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        name VARCHAR(120) NOT NULL, phone VARCHAR(30) NOT NULL, message TEXT NULL,
        status VARCHAR(20) DEFAULT 'new', ip VARCHAR(45) NULL,
        INDEX idx_created (created_at), INDEX idx_status (status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
});

function requireAdminRole(array $user): void {
    if (($user['role'] ?? '') !== 'admin') respondError('Admins only.', 403);
}

// ---- GET: the currently published rates (for the editor to preload) ----
if ($method === 'GET' && $action === 'get-rates') {
    $st = $db->prepare("SELECT sval FROM app_settings WHERE skey='public_rates'");
    $st->execute();
    $row = $st->fetch();
    $v = $row ? json_decode($row['sval'], true) : null;
    respond(is_array($v) ? $v : ['as_of' => null, 'items' => []]);
}

// ---- POST: publish a curated rate list to the website ----
// body: { as_of, items: [{ name, name_ta, price, unit, note }] }
if ($method === 'POST' && $action === 'save-rates') {
    requireAdminRole($user);
    $b = getBody();
    $items = [];
    foreach (($b['items'] ?? []) as $it) {
        $name = trim((string)($it['name'] ?? ''));
        if ($name === '') continue;
        $items[] = [
            'name'    => mb_substr($name, 0, 80),
            'name_ta' => mb_substr(trim((string)($it['name_ta'] ?? '')), 0, 80),
            'price'   => (float)($it['price'] ?? 0),
            'unit'    => mb_substr(trim((string)($it['unit'] ?? 'kg')), 0, 12),
            'note'    => mb_substr(trim((string)($it['note'] ?? '')), 0, 60),
        ];
    }
    $val = [
        'as_of'        => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($b['as_of'] ?? '')) ? $b['as_of'] : date('Y-m-d'),
        'published_at' => date('Y-m-d H:i:s'),
        'items'        => $items,
    ];
    $db->prepare("INSERT INTO app_settings (skey, sval) VALUES ('public_rates', ?)
                  ON DUPLICATE KEY UPDATE sval = VALUES(sval)")
       ->execute([json_encode($val, JSON_UNESCAPED_UNICODE)]);
    auditLog('UPDATE', 'settings', 'public_rates', "Published " . count($items) . " website rates", ['as_of' => $val['as_of'], 'count' => count($items)]);
    respond(['action' => 'published', 'count' => count($items), 'as_of' => $val['as_of']]);
}

// ---- GET: list website enquiries ----
if ($method === 'GET' && $action === 'enquiries') {
    $rows = $db->query("SELECT id, created_at, name, phone, message, status
                        FROM enquiries ORDER BY created_at DESC LIMIT 300")->fetchAll();
    respondList($rows);
}

// ---- POST: update or delete an enquiry ----
// body: { id, status } | { id, delete: true }
if ($method === 'POST' && $action === 'enquiry-status') {
    requireAdminRole($user);
    $b  = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');
    if (!empty($b['delete'])) {
        $db->prepare("DELETE FROM enquiries WHERE id=?")->execute([$id]);
        auditLog('DELETE', 'enquiry', $id, "Deleted website enquiry");
        respond(['action' => 'deleted', 'id' => $id]);
    }
    $status = in_array($b['status'] ?? '', ['new', 'contacted', 'closed'], true) ? $b['status'] : 'contacted';
    $db->prepare("UPDATE enquiries SET status=? WHERE id=?")->execute([$status, $id]);
    auditLog('UPDATE', 'enquiry', $id, "Enquiry → $status");
    respond(['action' => 'updated', 'id' => $id, 'status' => $status]);
}

respondError('Invalid action', 400);
