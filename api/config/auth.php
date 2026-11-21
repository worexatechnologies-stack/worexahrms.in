<?php
declare(strict_types=1);

function base64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function base64url_decode(string $value): string
{
    return base64_decode(strtr($value, '-_', '+/')) ?: '';
}

function jwt_secret(): string
{
    $secret = getenv('HRMS_JWT_SECRET') ?: ($_ENV['HRMS_JWT_SECRET'] ?? ($_SERVER['HRMS_JWT_SECRET'] ?? ''));
    if ($secret === '' || strlen($secret) < 16) {
        error_log('[CRITICAL SECURITY ERROR] HRMS_JWT_SECRET is not configured or insecurely short in environment.');
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'message' => 'Authentication service configuration error. Please contact the administrator.',
            'data'    => null,
        ]);
        exit;
    }
    return $secret;
}

function create_token(array $user, string $role): string
{
    $header = ['typ' => 'JWT', 'alg' => 'HS256'];
    $companyDb = (string)($user['company_db'] ?? get_active_db_name());
    $companyName = (string)($user['company_name'] ?? ($companyDb === 'hrms_viyana' ? 'Viyana Production' : 'Worexa'));
    $companySlug = (string)($user['company_slug'] ?? ($companyDb === 'hrms_viyana' ? 'viyana' : 'worexa'));

    $payload = [
        'sub'  => (string) ($user['id'] ?? $user['_id'] ?? ''),
        'email' => $user['email'],
        'name'  => $user['name'],
        'role'  => $role,
        'company_db' => $companyDb,
        'company_name' => $companyName,
        'company_slug' => $companySlug,
        'iat'   => time(),
        'exp'   => time() + (60 * 60 * 24 * 7),
    ];
    $segments = [
        base64url_encode(json_encode($header)),
        base64url_encode(json_encode($payload)),
    ];
    $signature = hash_hmac('sha256', implode('.', $segments), jwt_secret(), true);
    $segments[] = base64url_encode($signature);
    return implode('.', $segments);
}

function auth_cookie_options(int $expires): array
{
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || (($_SERVER['HTTP_X_FORWARDED_SSL'] ?? '') === 'on')
        || (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443)
        || (($_SERVER['HTTP_CF_VISITOR'] ?? '') && str_contains($_SERVER['HTTP_CF_VISITOR'], 'https'));
    $isProduction = strtolower((string)(getenv('APP_ENV') ?: getenv('HRMS_ENV') ?: 'local')) === 'production';

    $sameSite = getenv('HRMS_COOKIE_SAMESITE') ?: 'Lax';
    if ($sameSite === 'None' && !$isHttps) $sameSite = 'Lax';

    return [
        'expires' => $expires,
        'path' => '/',
        'secure' => $isProduction || $isHttps,
        'httponly' => true,
        'samesite' => $sameSite,
    ];
}

function set_auth_cookie(string $token): void
{
    setcookie('hrms_token', $token, auth_cookie_options(time() + (60 * 60 * 24 * 7)));
}

function clear_auth_cookie(): void
{
    setcookie('hrms_token', '', auth_cookie_options(time() - 3600));
}

function bearer_token(): ?string
{
    if (!empty($_COOKIE['hrms_token'])) {
        return $_COOKIE['hrms_token'];
    }

    $header = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? (function_exists('apache_request_headers') ? (apache_request_headers()['Authorization'] ?? (apache_request_headers()['authorization'] ?? null)) : null)
        ?? '';

    if (is_string($header) && preg_match('/Bearer\s+(\S+)/i', $header, $matches)) {
        return $matches[1];
    }

    return null;
}

function decode_token(?string $token): ?array
{
    if (!$token) return null;
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    [$headerB64, $payloadB64, $signature] = $parts;

    // Verify token header algorithm and type
    $headerRaw = base64url_decode($headerB64);
    $header = json_decode($headerRaw, true);
    if (!is_array($header) || ($header['alg'] ?? '') !== 'HS256' || ($header['typ'] ?? '') !== 'JWT') {
        return null;
    }

    $expected = base64url_encode(hash_hmac('sha256', "{$headerB64}.{$payloadB64}", jwt_secret(), true));
    if (!hash_equals($expected, $signature)) return null;

    $claims = json_decode(base64url_decode($payloadB64), true);
    if (!is_array($claims) || (($claims['exp'] ?? 0) < time())) return null;

    return $claims;
}

function current_user(): array
{
    static $cachedUser = null;
    if ($cachedUser !== null) {
        return $cachedUser;
    }

    $claims = decode_token(bearer_token());
    if (!$claims || empty($claims['sub'])) fail('Authentication required.', 401);

    // ── CRITICAL: Activate the correct company database BEFORE any queries ──
    if (!empty($claims['company_db'])) {
        set_active_db_name($claims['company_db']);
    }

    $role = $claims['role'] ?? '';
    $userIdStr = (string) ($claims['sub'] ?? '');

    // Check if sub is a valid MongoDB ObjectId or integer fallback
    $isMongoId = preg_match('/^[a-f\d]{24}$/i', $userIdStr);
    $queryId = $isMongoId ? new MongoDB\BSON\ObjectId($userIdStr) : (int) $userIdStr;

    if ($role === 'hr') {
        $user = findOne(collection('users'), ['_id' => $queryId]);
        if (!$user && !$isMongoId) {
             $user = findOne(collection('users'), ['id' => $queryId]);
        }
        if (!$user) fail('Authentication required.', 401);

        // Account status check for HR
        if (isset($user['status']) && strtolower((string)$user['status']) === 'inactive') {
            fail('Your account has been deactivated. Please contact support.', 403);
        }

        $user['id'] = (string) $user['_id'];
        $user['company_db'] = $claims['company_db'] ?? get_active_db_name();
        $user['company_name'] = $claims['company_name'] ?? ($user['company_name'] ?? ($user['company_db'] === 'hrms_viyana' ? 'Viyana Production' : 'Worexa'));
        $user['company_slug'] = $claims['company_slug'] ?? ($user['company_slug'] ?? ($user['company_db'] === 'hrms_viyana' ? 'viyana' : 'worexa'));
        return $cachedUser = $user;
    }

    // Employee role
    $employee = findOne(collection('employees'), ['_id' => $queryId, 'status' => 'active']);
    if (!$employee && !$isMongoId) {
        $employee = findOne(collection('employees'), ['id' => $queryId, 'status' => 'active']);
    }

    if (!$employee) {
        // Check if account exists but has been deactivated
        $inactive = findOne(collection('employees'), ['_id' => $queryId])
            ?: (!$isMongoId ? findOne(collection('employees'), ['id' => $queryId]) : null);
        if ($inactive && isset($inactive['status']) && $inactive['status'] !== 'active') {
            fail('Your employee account has been deactivated. Please contact HR.', 403);
        }
        fail('Authentication required.', 401);
    }

    $employee['id'] = (string) $employee['_id'];
    $employee['role'] = 'employee';
    $employee['company_db'] = $claims['company_db'] ?? get_active_db_name();
    $employee['company_name'] = $claims['company_name'] ?? ($employee['company_name'] ?? ($employee['company_db'] === 'hrms_viyana' ? 'Viyana Production' : 'Worexa'));
    $employee['company_slug'] = $claims['company_slug'] ?? ($employee['company_slug'] ?? ($employee['company_db'] === 'hrms_viyana' ? 'viyana' : 'worexa'));
    return $cachedUser = $employee;
}

/**
 * Backward-compatible alias for current_user()
 */
function authUser(): array
{
    return current_user();
}
