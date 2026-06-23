<?php
// ============================================================
//  IDNUK SOFTWARE - Public client config (no auth)
//  GET /api/config  -> { sentry_dsn } for the browser error reporter.
//  Returns empty string if no frontend DSN is configured (reporting off).
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$dsn = defined('SENTRY_DSN_JS') && SENTRY_DSN_JS ? SENTRY_DSN_JS : (getenv('SENTRY_DSN_JS') ?: '');
respond(['sentry_dsn' => $dsn]);
