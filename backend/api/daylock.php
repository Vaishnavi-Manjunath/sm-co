<?php
// ============================================================
//  IDNUK SOFTWARE - Day Lock API
//  Freeze a finished business day so its bills/money can't change.
//
//  GET  /api/daylock?action=status            - working date + locked dates
//  POST /api/daylock?action=lock              - lock a day  {date, note?}
//  POST /api/daylock?action=unlock            - unlock a day {date}   (admin only)
//  POST /api/daylock?action=set-business-date - set working date {date}
// ============================================================
require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();           // also ensures the day_locks + app_settings tables
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'status');
$db     = getDB();

migrateOnce('app_settings', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS app_settings (
        skey       VARCHAR(50) PRIMARY KEY,
        sval       MEDIUMTEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
});

function validDate(?string $d): bool {
    return $d && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && strtotime($d) !== false;
}

// ---- GET: status (working date, today, locked dates) ----
if ($method === 'GET' && $action === 'status') {
    $locked = $db->query("SELECT lock_date, locked_by, locked_at, note
                          FROM day_locks ORDER BY lock_date DESC")->fetchAll();
    $business = businessDate();
    respond([
        'today'         => date('Y-m-d'),
        'business_date' => $business,
        'business_locked' => isDayLocked($business),
        'locked_dates'  => array_map(fn($r) => $r['lock_date'], $locked),
        'locks'         => $locked,            // full rows for the admin panel
    ]);
}

// ---- POST: lock a day (any logged-in user may close a day) ----
if ($method === 'POST' && $action === 'lock') {
    $b = getBody();
    $date = $b['date'] ?? null;
    if (!validDate($date)) respondError('Valid date (YYYY-MM-DD) required');
    if (isDayLocked($date)) respond(['date' => $date, 'already_locked' => true]);

    $db->prepare("INSERT INTO day_locks (lock_date, locked_by, locked_at, note)
                  VALUES (?,?,?,?)
                  ON DUPLICATE KEY UPDATE locked_by = VALUES(locked_by),
                                          locked_at = VALUES(locked_at),
                                          note      = VALUES(note)")
       ->execute([$date, $user['username'], date('Y-m-d H:i:s'), $b['note'] ?? null]);
    auditLog('LOCK', 'day_lock', $date, "Locked day $date", ['note' => $b['note'] ?? null]);
    respond(['date' => $date, 'locked' => true]);
}

// ---- POST: unlock a day (ADMIN ONLY) ----
if ($method === 'POST' && $action === 'unlock') {
    if (($user['role'] ?? '') !== 'admin') {
        respondError('Only an admin can unlock a day.', 403);
    }
    $b = getBody();
    $date = $b['date'] ?? null;
    if (!validDate($date)) respondError('Valid date (YYYY-MM-DD) required');

    $db->prepare("DELETE FROM day_locks WHERE lock_date = ?")->execute([$date]);
    auditLog('UNLOCK', 'day_lock', $date, "Unlocked day $date", ['reason' => $b['reason'] ?? null]);
    respond(['date' => $date, 'locked' => false]);
}

// ---- POST: set the working/business date (new entries default to it) ----
if ($method === 'POST' && $action === 'set-business-date') {
    $b = getBody();
    $date = $b['date'] ?? null;
    if (!validDate($date)) respondError('Valid date (YYYY-MM-DD) required');
    if (isDayLocked($date)) {
        respondError("Day $date is locked. Pick an open day, or ask an admin to unlock it.", 423);
    }
    $db->prepare("INSERT INTO app_settings (skey, sval) VALUES ('business_date', ?)
                  ON DUPLICATE KEY UPDATE sval = VALUES(sval)")->execute([$date]);
    auditLog('UPDATE', 'settings', 'business_date', "Set working date to $date", ['date' => $date]);
    respond(['business_date' => $date]);
}

respondError('Invalid action', 400);
