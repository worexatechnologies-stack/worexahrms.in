<?php
declare(strict_types=1);

// Production hardening: never corrupt API JSON responses with inline PHP notices or leak server paths
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');

$GLOBALS['_HRMS_START_HRTIME'] = hrtime(true);
$GLOBALS['_HRMS_DB_TIME_MS'] = 0.0;
$GLOBALS['_HRMS_DB_QUERY_COUNT'] = 0;

// Safe request correlation ID (from incoming header or generated)
$incomingReqId = $_SERVER['HTTP_X_REQUEST_ID'] ?? '';
$GLOBALS['_HRMS_REQUEST_ID'] = (preg_match('/^[a-zA-Z0-9_-]{8,64}$/', $incomingReqId))
    ? $incomingReqId
    : bin2hex(random_bytes(16));

/* ── Global safety net: catch any uncaught exception and return JSON ── */
set_exception_handler(function (Throwable $e): void {
    // Log to file (not visible to user)
    $logDir = dirname(__DIR__, 2) . '/logs';
    if (!is_dir($logDir)) {
        @mkdir($logDir, 0750);
    }
    @file_put_contents(
        $logDir . '/errors-' . date('Y-m-d') . '.log',
        date('[Y-m-d H:i:s]') . ' ' . get_class($e) . ': ' . $e->getMessage()
            . ' in ' . $e->getFile() . ':' . $e->getLine() . PHP_EOL . $e->getTraceAsString() . PHP_EOL . PHP_EOL,
        FILE_APPEND | LOCK_EX
    );

    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['success' => false, 'message' => 'An unexpected server error occurred. Please try again.', 'data' => null]);
    exit;
});

// Load base .env first, then override with .env.local if present
$loadEnv = function (string $filePath): void {
    if (!file_exists($filePath)) return;
    $lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#')) continue;
        if (str_contains($line, '=')) {
            list($name, $value) = explode('=', $line, 2);
            $name = trim($name);
            $value = trim($value);
            putenv(sprintf('%s=%s', $name, $value));
            $_ENV[$name] = $value;
            $_SERVER[$name] = $value;
        }
    }
};

$loadEnv(dirname(__DIR__, 2) . '/.env');
$loadEnv(dirname(__DIR__) . '/.env');

// Fallback to secure config in case .env was omitted during deployment
if (empty(getenv('MONGODB_URI')) && empty($_ENV['MONGODB_URI']) && empty($_SERVER['MONGODB_URI'])) {
    if (file_exists(__DIR__ . '/env.php')) {
        require_once __DIR__ . '/env.php';
    }
}

// NEVER load .env.local on production domains (e.g. worexahrms.xyz)
$host = $_SERVER['HTTP_HOST'] ?? '';
$isCliServer = (php_sapi_name() === 'cli-server');
$isLocalHost = in_array(strtolower(explode(':', $host)[0]), ['localhost', '127.0.0.1', ''], true) || $isCliServer;
$isProductionHost = str_contains(strtolower($host), 'worexahrms.xyz');

// Load .env.local only in local development environments
if (($isLocalHost || $isCliServer) && !$isProductionHost) {
    $loadEnv(dirname(__DIR__, 2) . '/.env.local');
    $loadEnv(dirname(__DIR__) . '/.env.local');
}

$isProductionEnv = !$isCliServer && (
    $isProductionHost ||
    strtolower((string)(getenv('APP_ENV') ?: getenv('HRMS_ENV') ?: '')) === 'production'
);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/mongodb.php';
require_once __DIR__ . '/mongodb-helpers.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/rate-limit.php';

// ── Strict Exact-Origin CORS Configuration ─────────────────────────
$httpOrigin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));
$serverHost = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]);
$originHost = ($httpOrigin !== '') ? strtolower((string)parse_url($httpOrigin, PHP_URL_HOST)) : '';

// Canonicalize origins: trim whitespace and trailing slashes
$canonicalOrigin = rtrim($httpOrigin, '/');

// Build explicit allowlist from environment configuration
$rawAllowed = getenv('HRMS_ALLOWED_ORIGINS') ?: ($_ENV['HRMS_ALLOWED_ORIGINS'] ?? ($_SERVER['HRMS_ALLOWED_ORIGINS'] ?? ''));
$envFrontend = getenv('HRMS_FRONTEND_ORIGIN') ?: ($_ENV['HRMS_FRONTEND_ORIGIN'] ?? ($_SERVER['HRMS_FRONTEND_ORIGIN'] ?? ''));

$allowedOrigins = [];
if (!empty($rawAllowed)) {
    foreach (explode(',', $rawAllowed) as $orig) {
        $clean = rtrim(trim($orig), '/');
        if ($clean !== '') {
            $allowedOrigins[] = $clean;
        }
    }
}
if (!empty($envFrontend)) {
    $clean = rtrim(trim($envFrontend), '/');
    if ($clean !== '') {
        $allowedOrigins[] = $clean;
    }
}

// In local dev environments, allow standard dev server ports if not already configured
if ($isLocalHost && empty($allowedOrigins)) {
    $allowedOrigins = [
        'http://localhost:5173', 'http://127.0.0.1:5173',
        'http://localhost:5174', 'http://127.0.0.1:5174',
        'http://localhost:3000'
    ];
}

// Evaluate exact match or same-host match
$isOriginAllowed = false;
if ($canonicalOrigin !== '') {
    if (in_array($canonicalOrigin, $allowedOrigins, true)) {
        $isOriginAllowed = true;
    } elseif ($serverHost !== '' && $originHost === $serverHost) {
        // Exact same host as the server (e.g. deployed on the same domain)
        $isOriginAllowed = true;
    } elseif (!$isProductionEnv && preg_match('/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/', $originHost) === 1) {
        // Dev LAN testing (e.g. phone or peer device on same local network)
        $isOriginAllowed = true;
    }
}

// Always attach Vary: Origin so responses are never cached across different origins
header('Vary: Origin');

if ($isOriginAllowed) {
    header("Access-Control-Allow-Origin: {$canonicalOrigin}");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-Id, X-Requested-With');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Max-Age: 86400');
}

header('Access-Control-Expose-Headers: Retry-After, Server-Timing, X-Request-Id, X-DB-Queries');
header('Content-Type: application/json; charset=utf-8');

// Handle preflight OPTIONS request strictly
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    if ($isOriginAllowed || empty($httpOrigin)) {
        http_response_code(204);
        exit;
    }
    // Reject untrusted cross-origin preflight requests
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Cross-origin preflight request blocked.']);
    exit;
}

// Reject unauthorized cross-origin or cross-site state-changing mutations
$secFetchSite = strtolower((string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
if (($secFetchSite === 'cross-site' || (!empty($httpOrigin) && !$isOriginAllowed))) {
    $reqMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if (in_array($reqMethod, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'message' => 'Unauthorized cross-origin request rejected.',
            'data' => null
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }
}

function input(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') {
        return $_POST ?: [];
    }

    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function respond(array $payload, int $status = 200): never
{
    $totalMs = (hrtime(true) - ($GLOBALS['_HRMS_START_HRTIME'] ?? hrtime(true))) / 1e6;
    $dbMs = (float)($GLOBALS['_HRMS_DB_TIME_MS'] ?? 0.0);
    $qCount = (int)($GLOBALS['_HRMS_DB_QUERY_COUNT'] ?? 0);
    $reqId = (string)($GLOBALS['_HRMS_REQUEST_ID'] ?? '');

    if (!headers_sent()) {
        http_response_code($status);
        if ($reqId !== '') {
            header("X-Request-Id: {$reqId}");
        }
        header("X-DB-Queries: {$qCount}");
        header(sprintf(
            'Server-Timing: total;dur=%.2f, db;dur=%.2f;desc="%d queries"',
            $totalMs,
            $dbMs,
            $qCount
        ));
    }
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function ok(mixed $data = null, string $message = 'OK', int $status = 200): never
{
    respond(['success' => true, 'message' => $message, 'data' => $data], $status);
}

function fail(string $message, int $status = 400, array $errors = []): never
{
    respond(['success' => false, 'message' => $message, 'errors' => $errors], $status);
}

function require_fields(array $data, array $fields): void
{
    $errors = [];
    foreach ($fields as $field) {
        if (!isset($data[$field]) || trim((string) $data[$field]) === '') {
            $errors[$field][] = 'This field is required.';
        }
    }

    if ($errors) {
        fail('Validation failed.', 422, $errors);
    }
}

function method(): string
{
    $m = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if ($m === 'POST') {
        $override = $_POST['_method'] ?? $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? '';
        if (in_array(strtoupper($override), ['PUT', 'PATCH', 'DELETE'], true)) return strtoupper($override);
    }
    return $m;
}

function id_param(): ?string
{
    $id = $_GET['id'] ?? null;
    if ($id === null || $id === '') return null;
    return (string) $id;
}
