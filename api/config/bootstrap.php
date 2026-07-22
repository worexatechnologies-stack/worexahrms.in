<?php
declare(strict_types=1);

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
        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['success' => false, 'message' => 'An unexpected error occurred. Please try again.', 'data' => null]);
    exit;
});

// Load .env.local first (local dev), fall back to .env (production)
$envLocal = dirname(__DIR__, 2) . '/.env.local';
$envProd  = dirname(__DIR__, 2) . '/.env';
$envFile  = file_exists($envLocal) ? $envLocal : $envProd;
if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (str_starts_with(trim($line), '#')) continue;
        if (str_contains($line, '=')) {
            list($name, $value) = explode('=', $line, 2);
            $name = trim($name);
            $value = trim($value);
            putenv(sprintf('%s=%s', $name, $value));
            $_ENV[$name] = $value;
            $_SERVER[$name] = $value;
        }
    }
}

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/mongodb.php';
require_once __DIR__ . '/mongodb-helpers.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/rate-limit.php';

$origin = getenv('HRMS_FRONTEND_ORIGIN') ?: ($_SERVER['HTTP_ORIGIN'] ?? 'http://localhost:5173');
$allowed = array_filter(array_map('trim', explode(',', getenv('HRMS_ALLOWED_ORIGINS') ?: 'http://localhost:5173,http://127.0.0.1:5173')));
if (in_array($origin, $allowed, true)) {
    header("Access-Control-Allow-Origin: {$origin}");
}
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Expose-Headers: Retry-After');
header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
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
    http_response_code($status);
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
