<?php
// ============================================================
//  IDNUK SOFTWARE - Auth API
//  POST /api/auth/login
//  POST /api/auth/logout
//  GET  /api/auth/me
// ============================================================


error_reporting(E_ALL);
ini_set('display_errors', 0);

header('Content-Type: application/json');

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'login');

$db = getDB();
migrateOnce('auth', 2, function ($db) {
    // Users table (created first so ALTER TABLE below never fails on a fresh install)
    $db->exec("CREATE TABLE IF NOT EXISTS users (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        username        VARCHAR(50)  NOT NULL UNIQUE,
        full_name       VARCHAR(100) NOT NULL,
        full_name_tamil VARCHAR(100) NULL,
        role            VARCHAR(20)  NOT NULL DEFAULT 'staff',
        permissions     TEXT         NULL,
        password_hash   VARCHAR(255) NOT NULL,
        is_active       TINYINT(1)   NOT NULL DEFAULT 1,
        last_login      DATETIME     NULL,
        created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    // Seed a default admin on first install (only when table is empty)
    $count = (int)$db->query("SELECT COUNT(*) FROM users")->fetchColumn();
    if ($count === 0) {
        $db->prepare("INSERT INTO users (username, full_name, role, is_active, password_hash)
                      VALUES (?,?,?,?,?)")
           ->execute(['admin', 'Administrator', 'admin', 1,
                      password_hash('Admin@1234', PASSWORD_BCRYPT)]);
    }
    try { $db->exec("ALTER TABLE users ADD COLUMN permissions TEXT NULL"); } catch (PDOException $e) {}
    $db->exec("CREATE TABLE IF NOT EXISTS user_sessions (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id    INT UNSIGNED NOT NULL,
        token      VARCHAR(64)  NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        INDEX idx_token (token)
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS login_attempts (
        id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        ip           VARCHAR(45) NOT NULL,
        username     VARCHAR(50),
        success      TINYINT(1) DEFAULT 0,
        attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ip_time (ip, attempted_at),
        INDEX idx_user_time (username, attempted_at)
    )");
    try { $db->exec("ALTER TABLE login_attempts ADD INDEX idx_user_time (username, attempted_at)"); } catch (PDOException $e) {}
});

if ($method === 'POST' && $action === 'login') {
    $body = getBody();
    $username = trim($body['username'] ?? '');
    $password = $body['password'] ?? '';
    // REMOTE_ADDR only — X-Forwarded-For is client-controlled and would let an
    // attacker rotate a fake header to dodge the lockout.
    $ip = substr($_SERVER['REMOTE_ADDR'] ?? 'unknown', 0, 45);

    if (!$username || !$password) respondError('Username and password required');

    // Lock out after 8 failed attempts in 15 minutes — counted per IP *or* per
    // username, so neither rotating addresses nor hammering one account works.
    $fc = $db->prepare("SELECT COUNT(*) FROM login_attempts
                        WHERE (ip = ? OR username = ?) AND success = 0
                          AND attempted_at > (NOW() - INTERVAL 15 MINUTE)");
    $fc->execute([$ip, $username]);
    if ((int)$fc->fetchColumn() >= 8) {
        respondError('Too many failed attempts. Please wait 15 minutes and try again.', 429);
    }

    $stmt = $db->prepare("SELECT id, username, full_name, full_name_tamil, role, permissions, password_hash
                          FROM users WHERE username = ? AND is_active = 1");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        $db->prepare("INSERT INTO login_attempts (ip, username, success) VALUES (?,?,0)")->execute([$ip, $username]);
        respondError('Invalid username or password', 401);
    }
    // Success — clear this IP's/user's recent failures and prune housekeeping rows
    $db->prepare("DELETE FROM login_attempts WHERE (ip = ? OR username = ?) AND success = 0")->execute([$ip, $username]);
    if (random_int(1, 20) === 1) $db->exec("DELETE FROM login_attempts WHERE attempted_at < (NOW() - INTERVAL 1 DAY)");
    $db->exec("DELETE FROM user_sessions WHERE expires_at < NOW()");   // expired tokens don't accumulate
    $user['permissions'] = json_decode($user['permissions'] ?? '[]', true) ?: [];

    // Generate token
    $token = bin2hex(random_bytes(32));
    $expires = date('Y-m-d H:i:s', strtotime('+8 hours'));
    $db->prepare("INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, ?)")
       ->execute([$user['id'], $token, $expires]);

    // Update last login
    $db->prepare("UPDATE users SET last_login = NOW() WHERE id = ?")->execute([$user['id']]);

    unset($user['password_hash']);
    respond(['token' => $token, 'user' => $user, 'expires_at' => $expires]);
}

if ($method === 'POST' && $action === 'logout') {
    $token = str_replace('Bearer ', '', $_SERVER['HTTP_AUTHORIZATION'] ?? '');
    if ($token) {
        $db->prepare("DELETE FROM user_sessions WHERE token = ?")->execute([$token]);
    }
    respond(['message' => 'Logged out']);
}

if ($method === 'GET' && $action === 'me') {
    $user = requireAuth();
    respond($user);
}

// First-time setup: create default admin password if placeholder
if ($method === 'POST' && $action === 'setup') {
    $body = getBody();
    $secret = $body['setup_key'] ?? '';
    if ($secret !== 'RSMARKET_SETUP_2024') respondError('Invalid setup key', 403);

    $password = $body['password'] ?? 'Admin@1234';
    $hash = password_hash($password, PASSWORD_BCRYPT);
    $db->prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'")->execute([$hash]);
    respond(['message' => 'Admin password set successfully']);
}

// ---- Admin: list users ----
if ($method === 'GET' && $action === 'users-list') {
    $me = requireAuth();
    if ($me['role'] !== 'admin') respondError('Admin only', 403);
    $stmt = $db->query("SELECT id, username, full_name, role, permissions, is_active FROM users ORDER BY id");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) { $r['permissions'] = json_decode($r['permissions'] ?? '[]', true) ?: []; }
    respondList($rows);
}

// ---- Admin: create / update a user ----
if ($method === 'POST' && $action === 'user-save') {
    $me = requireAuth();
    if ($me['role'] !== 'admin') respondError('Admin only', 403);
    $b = getBody();
    $username = trim($b['username'] ?? '');
    if (!$username) respondError('Username required');
    $perms = json_encode(array_values($b['permissions'] ?? []), JSON_UNESCAPED_UNICODE);
    $role  = ($b['role'] ?? 'staff') === 'admin' ? 'admin' : 'staff';
    $active = isset($b['is_active']) ? (int)(bool)$b['is_active'] : 1;

    if (!empty($b['id'])) {
        // Update; only change password if provided
        if (!empty($b['password'])) {
            $db->prepare("UPDATE users SET username=?, full_name=?, role=?, permissions=?, is_active=?, password_hash=? WHERE id=?")
               ->execute([$username, $b['full_name'] ?? $username, $role, $perms, $active, password_hash($b['password'], PASSWORD_BCRYPT), $b['id']]);
        } else {
            $db->prepare("UPDATE users SET username=?, full_name=?, role=?, permissions=?, is_active=? WHERE id=?")
               ->execute([$username, $b['full_name'] ?? $username, $role, $perms, $active, $b['id']]);
        }
        respond(['id' => $b['id'], 'action' => 'updated']);
    } else {
        if (empty($b['password'])) respondError('Password required for new user');
        // unique username
        $chk = $db->prepare("SELECT id FROM users WHERE username=?"); $chk->execute([$username]);
        if ($chk->fetch()) respondError('Username already exists');
        $db->prepare("INSERT INTO users (username, full_name, role, permissions, is_active, password_hash)
                      VALUES (?,?,?,?,?,?)")
           ->execute([$username, $b['full_name'] ?? $username, $role, $perms, $active, password_hash($b['password'], PASSWORD_BCRYPT)]);
        respond(['id' => $db->lastInsertId(), 'action' => 'created']);
    }
}

respondError('Invalid request', 400);
