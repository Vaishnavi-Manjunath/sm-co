<?php
// ============================================================
//  IDNUK SOFTWARE - Database backup (admin only)
//  GET /api/backup                 -> downloads a full .sql dump (admin session)
//  GET /api/backup?key=SECRET&store=1 -> writes a dated dump to /backups (for cron)
//
//  Native PHP dump (no shell/mysqldump needed — works on shared hosting).
//  For automatic backups, add to config/database.php:  define('BACKUP_KEY','<long-random>');
//  then schedule a cPanel cron:  wget -qO- "https://YOURDOMAIN/api/backup.php?key=<that>&store=1"
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$key   = getParam('key', '');
$store = getParam('store', '') === '1';
$viaKey = $key !== '' && defined('BACKUP_KEY') && hash_equals(BACKUP_KEY, $key);

if (!$viaKey) {
    $user = requireAuth();
    if (($user['role'] ?? '') !== 'admin') respondError('Admin only', 403);
}

$db = getDB();
@set_time_limit(600);
@ini_set('memory_limit', '512M');

// Build the dump into a string (chunked reads keep memory bounded).
// $structureOnly = true → tables/views only, no rows (a readable schema map to commit).
function buildDump(PDO $db, bool $structureOnly = false): string {
    $out  = "-- IDNUK " . ($structureOnly ? 'schema (structure only)' : 'backup') . " " . date('c') .
            "\nSET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n";
    $tables = $db->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tables as $t) {
        $create = $db->query("SHOW CREATE TABLE `$t`")->fetch(PDO::FETCH_ASSOC);
        $ddl = $create['Create Table'] ?? ($create['Create View'] ?? null);
        if ($ddl === null) continue;                       // skip if unreadable
        if (stripos($ddl, 'CREATE VIEW') !== false || isset($create['Create View'])) {
            $out .= "DROP VIEW IF EXISTS `$t`;\n$ddl;\n\n";
            continue;
        }
        // Drop the live AUTO_INCREMENT counter so the schema file stays stable across regenerations.
        if ($structureOnly) $ddl = preg_replace('/ AUTO_INCREMENT=\d+/i', '', $ddl);
        $out .= "DROP TABLE IF EXISTS `$t`;\n$ddl;\n";
        if ($structureOnly) { $out .= "\n"; continue; }    // schema map: no data rows
        $count = (int)$db->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
        for ($off = 0; $off < $count; $off += 1000) {
            $rows = $db->query("SELECT * FROM `$t` LIMIT $off, 1000")->fetchAll(PDO::FETCH_ASSOC);
            if (!$rows) break;
            foreach ($rows as $r) {
                $vals = array_map(fn($v) => $v === null ? 'NULL' : $db->quote((string)$v), array_values($r));
                $out .= "INSERT INTO `$t` VALUES (" . implode(',', $vals) . ");\n";
            }
        }
        $out .= "\n";
    }
    $out .= "SET FOREIGN_KEY_CHECKS=1;\n";
    return $out;
}

$structure = getParam('structure', '') === '1';
$dump = buildDump($db, $structure);
$name = ($structure ? 'idnuk_schema_' : 'idnuk_backup_') . date('Y-m-d_His') . '.sql';

if ($store) {
    // Write to a protected /backups folder and keep the most recent 14
    $dir = $_SERVER['DOCUMENT_ROOT'] . '/backups';
    if (!is_dir($dir)) { @mkdir($dir, 0750, true); @file_put_contents("$dir/.htaccess", "Require all denied\nDeny from all\n"); }
    @file_put_contents("$dir/$name", $dump);
    $files = glob("$dir/idnuk_backup_*.sql");
    if ($files) { sort($files); while (count($files) > 14) { @unlink(array_shift($files)); } }
    respond(['stored' => $name, 'bytes' => strlen($dump), 'kept' => min(count(glob("$dir/idnuk_backup_*.sql")), 14)]);
}

// Stream as a download
header('Content-Type: application/sql; charset=utf-8');
header("Content-Disposition: attachment; filename=\"$name\"");
header('Content-Length: ' . strlen($dump));
echo $dump;
exit();
