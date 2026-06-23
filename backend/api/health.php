<?php
// ============================================================
//  IDNUK SOFTWARE - Health check (public, no auth)
//  GET /api/health  -> 200 {status:ok, db:ok} or 503 if the DB is down.
//  Point an uptime monitor (e.g. UptimeRobot) at this URL.
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

try {
    $db = getDB();
    $db->query('SELECT 1');
    http_response_code(200);
    echo json_encode(['success' => true, 'status' => 'ok', 'db' => 'ok', 'time' => date('c')]);
} catch (Throwable $e) {
    http_response_code(503);
    echo json_encode(['success' => false, 'status' => 'down', 'db' => 'error', 'time' => date('c')]);
}
exit();
