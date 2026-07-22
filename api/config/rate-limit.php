<?php
declare(strict_types=1);

function rate_limit(string $bucket, int $maxRequests, int $windowSeconds, string $subject = ''): void
{
    if ($maxRequests <= 0 || $windowSeconds <= 0) return;
    if (!function_exists('apcu_fetch') || !filter_var(ini_get('apc.enabled'), FILTER_VALIDATE_BOOL)) return;

    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $identity = $subject !== '' ? $subject : $ip;
    $key = 'hrms_rl_' . sha1($bucket . '|' . $identity . '|' . floor(time() / $windowSeconds));

    $count = apcu_inc($key, 1, $ok, $windowSeconds);
    if (!$ok) {
        apcu_add($key, 1, $windowSeconds);
        $count = 1;
    }

    if ($count > $maxRequests) {
        header('Retry-After: ' . $windowSeconds);
        fail('Too many requests. Please try again shortly.', 429);
    }
}
