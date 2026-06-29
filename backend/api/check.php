<?php
// Temporary diagnostics — shows server paths and DB connectivity. No auth needed.
// DELETE this file once the site is working.
header('Content-Type: application/json; charset=utf-8');
$root = $_SERVER['DOCUMENT_ROOT'] ?? '';
$helpersViaRoot  = file_exists($root . '/helpers/api.php');
$configViaRoot   = file_exists($root . '/config/database.php');
$helpersViaDir   = file_exists(dirname(__DIR__) . '/helpers/api.php');
$configViaDir    = file_exists(dirname(__DIR__) . '/config/database.php');

$dbStatus = 'skipped';
if ($configViaRoot) {
    try {
        require_once $root . '/config/database.php';
        $pdo = getDB();
        $pdo->query('SELECT 1');
        $dbStatus = 'ok';
    } catch (Throwable $e) {
        $dbStatus = 'error: ' . $e->getMessage();
    }
} elseif ($configViaDir) {
    $dbStatus = 'config found via __DIR__ but not via DOCUMENT_ROOT — path mismatch';
}

echo json_encode([
    'document_root'       => $root,
    'script_dir'          => __DIR__,
    'helpers_via_root'    => $helpersViaRoot,
    'config_via_root'     => $configViaRoot,
    'helpers_via_dir'     => $helpersViaDir,
    'config_via_dir'      => $configViaDir,
    'db'                  => $dbStatus,
    'php'                 => PHP_VERSION,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
