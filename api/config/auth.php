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
    return getenv('HRMS_JWT_SECRET') ?: 'change-this-secret-before-production';
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
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $isProduction = strtolower((string)(getenv('APP_ENV') ?: getenv('HRMS_ENV') ?: 'local')) === 'production';

    $sameSite = getenv('HRMS_COOKIE_SAMESITE') ?: (($isProduction || $isHttps) ? 'None' : 'Lax');
    // Cross-origin HTTPS deployments (common when the mobile app and API use
    // separate hosts) require SameSite=None; browsers also require Secure.
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
    return $_COOKIE['hrms_token'] ?? null;
}

function decode_token(?string $token): ?array
{
    if (!$token) return null;
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    [$header, $payload, $signature] = $parts;
    $expected = base64url_encode(hash_hmac('sha256', "{$header}.{$payload}", jwt_secret(), true));
    if (!hash_equals($expected, $signature)) return null;
    $claims = json_decode(base64url_decode($payload), true);
    if (!is_array($claims) || (($claims['exp'] ?? 0) < time())) return null;
    return $claims;
}

function current_user(): array
{
    $claims = decode_token(bearer_token());
    if (!$claims || empty($claims['sub'])) fail('Authentication required.', 401);

    // ── CRITICAL: Activate the correct company database BEFORE any queries ──
    // This ensures all collection() calls in this request go to the right DB.
    if (!empty($claims['company_db'])) {
        set_active_db_name($claims['company_db']);
    }

    $role = $claims['role'] ?? '';
    $userIdStr = (string) ($claims['sub'] ?? '');
    
    // Check if sub is a valid MongoDB ObjectId or just an integer fallback
    $isMongoId = preg_match('/^[a-f\d]{24}$/i', $userIdStr);
    $queryId = $isMongoId ? new MongoDB\BSON\ObjectId($userIdStr) : (int) $userIdStr;

    if ($role === 'hr') {
        $user = findOne(collection('users'), ['_id' => $queryId]);
        // Fallback to searching by int 'id' if the string ID didn't match (for partially migrated DBs)
        if (!$user && !$isMongoId) {
             $user = findOne(collection('users'), ['id' => $queryId]);
        }
        if (!$user) fail('Authentication required.', 401);
        $user['id'] = (string) $user['_id'];
        $user['company_db'] = $claims['company_db'] ?? get_active_db_name();
        $user['company_name'] = $claims['company_name'] ?? ($user['company_name'] ?? ($user['company_db'] === 'hrms_viyana' ? 'Viyana Production' : 'Worexa'));
        $user['company_slug'] = $claims['company_slug'] ?? ($user['company_slug'] ?? ($user['company_db'] === 'hrms_viyana' ? 'viyana' : 'worexa'));
        return $user;
    }
    
    // Employee role
    $employee = findOne(collection('employees'), ['_id' => $queryId, 'status' => 'active']);
    if (!$employee && !$isMongoId) {
        $employee = findOne(collection('employees'), ['id' => $queryId, 'status' => 'active']);
    }
    
    if (!$employee) fail('Authentication required.', 401);
    $employee['id'] = (string) $employee['_id'];
    $employee['role'] = 'employee';
    $employee['company_db'] = $claims['company_db'] ?? get_active_db_name();
    $employee['company_name'] = $claims['company_name'] ?? ($employee['company_name'] ?? ($employee['company_db'] === 'hrms_viyana' ? 'Viyana Production' : 'Worexa'));
    $employee['company_slug'] = $claims['company_slug'] ?? ($employee['company_slug'] ?? ($employee['company_db'] === 'hrms_viyana' ? 'viyana' : 'worexa'));
    return $employee;
    
    // Note: lunch-break auto-deactivation logic was removed from here (it ran on every
    // API request causing 4-6 extra DB ops per call). It now runs only inside dashboard.php
    // during the HR dashboard load, which is the correct place for a scheduled check.
    
    return $employee;
}
