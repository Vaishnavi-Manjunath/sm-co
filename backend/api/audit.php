<?php
// ============================================================
//  IDNUK SOFTWARE - Audit Trail (read-only, admin only)
//  GET /api/audit?action=list[&from&to&user_id&entity&q]
//  GET /api/audit?action=users   - distinct users for the filter
//  The log is append-only; there is no write/delete endpoint by design.
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user = requireAuth();
if (($user['role'] ?? '') !== 'admin') respondError('Admins only', 403);

$db     = getDB();
$action = getParam('action', 'list');

if ($action === 'users') {
    $rows = $db->query("SELECT DISTINCT user_id, username FROM audit_log WHERE username IS NOT NULL ORDER BY username")->fetchAll();
    respondList($rows);
}

if ($action === 'list') {
    $from   = getParam('from', date('Y-m-d', strtotime('-7 days')));
    $to     = getParam('to',   date('Y-m-d'));
    $userId = getParam('user_id');
    $entity = getParam('entity');
    $q      = trim((string)getParam('q', ''));
    $limit  = min(2000, max(1, (int)getParam('limit', 500)));

    $sql = "SELECT id, ts, user_id, username, action, entity, entity_id, label, details, ip
            FROM audit_log
            WHERE ts BETWEEN ? AND ?";
    $params = [$from . ' 00:00:00', $to . ' 23:59:59'];
    if ($userId !== null && $userId !== '') { $sql .= " AND user_id = ?"; $params[] = $userId; }
    if ($entity)                            { $sql .= " AND entity = ?";  $params[] = $entity; }
    if ($q !== '') {
        $sql .= " AND (label LIKE ? OR details LIKE ? OR entity_id = ?)";
        $params[] = "%$q%"; $params[] = "%$q%"; $params[] = $q;
    }
    $sql .= " ORDER BY id DESC LIMIT $limit";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

respondError('Invalid action', 400);
