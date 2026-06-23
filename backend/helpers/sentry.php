<?php
// ============================================================
//  IDNUK SOFTWARE - Minimal Sentry reporter (no Composer needed)
//  Inert unless SENTRY_DSN_PHP is defined (in config/database.php) or set
//  as an env var. Reports uncaught exceptions + fatal errors to Sentry.
// ============================================================

function sentry_dsn(): string {
    // Production-only: never report from local development or the staging subdomain
    // (keeps the live feed limited to real production errors).
    $host = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]);
    if (in_array($host, ['localhost', '127.0.0.1'], true) || str_starts_with($host, 'staging.')) return '';
    // Override by defining SENTRY_DSN_PHP in config/database.php, or set it to '' to disable.
    if (defined('SENTRY_DSN_PHP')) return SENTRY_DSN_PHP;
    $e = getenv('SENTRY_DSN_PHP');
    if ($e !== false) return $e;
    // Default project DSN (safe to embed — DSNs are public ingestion keys).
    return 'https://06d2bf0ba9fc00edc23c7e5ce5ba3f2e@o4511495729577984.ingest.de.sentry.io/4511495748649040';
}

// Build a Sentry envelope and POST it. Accepts a Throwable or a string message.
function sentry_capture(Throwable|string $err, string $level = 'error'): void {
    $dsn = sentry_dsn();
    if (!$dsn) return;
    if (!preg_match('#^https://([^@]+)@([^/]+)/(.+)$#', $dsn, $m)) return;
    [, $key, $host, $project] = $m;

    $isThrow = $err instanceof Throwable;
    $eventId = bin2hex(random_bytes(16));
    $event = [
        'event_id'    => $eventId,
        'timestamp'   => gmdate('Y-m-d\TH:i:s\Z'),
        'platform'    => 'php',
        'level'       => $level,
        'release'     => 'idnuk-api',
        'server_name' => $_SERVER['SERVER_NAME'] ?? php_uname('n'),
        'transaction' => $_SERVER['REQUEST_URI'] ?? '',
        'request'     => [
            'url'    => ($_SERVER['REQUEST_URI'] ?? ''),
            'method' => ($_SERVER['REQUEST_METHOD'] ?? ''),
        ],
    ];
    if ($isThrow) {
        $frames = [];
        foreach (array_reverse($err->getTrace()) as $f) {
            $frames[] = [
                'filename' => $f['file'] ?? '[internal]',
                'lineno'   => $f['line'] ?? 0,
                'function' => ($f['class'] ?? '') . ($f['type'] ?? '') . ($f['function'] ?? ''),
            ];
        }
        $frames[] = ['filename' => $err->getFile(), 'lineno' => $err->getLine(), 'function' => '<thrown>'];
        $event['exception'] = ['values' => [[
            'type'       => get_class($err),
            'value'      => $err->getMessage(),
            'stacktrace' => ['frames' => $frames],
        ]]];
    } else {
        $event['message'] = ['formatted' => $err];
    }

    $body = json_encode(['event_id' => $eventId, 'dsn' => $dsn]) . "\n"
          . json_encode(['type' => 'event']) . "\n"
          . json_encode($event);

    $ch = curl_init("https://$host/api/$project/envelope/");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 3,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/x-sentry-envelope',
            'X-Sentry-Auth: Sentry sentry_version=7, sentry_key=' . $key . ', sentry_client=idnuk-php/1.0',
        ],
        CURLOPT_POSTFIELDS     => $body,
    ]);
    @curl_exec($ch);
    @curl_close($ch);
}

// Install global handlers (called once from helpers/api.php).
function sentry_init(): void {
    if (!sentry_dsn()) return;

    set_exception_handler(function (Throwable $e) {
        sentry_capture($e);
        if (!headers_sent()) {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'Server error']);
        }
    });

    register_shutdown_function(function () {
        $e = error_get_last();
        if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
            sentry_capture($e['message'] . ' in ' . $e['file'] . ':' . $e['line']);
        }
    });
}
