<?php
declare(strict_types=1);

function rate_limit(string $bucket, int $maxRequests, int $windowSeconds, string $subject = ''): void
{
    if ($maxRequests <= 0 || $windowSeconds <= 0) return;

    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $identity = $subject !== '' ? $subject : $ip;
    $window = floor(time() / $windowSeconds);
    $hash = sha1($bucket . '|' . $identity . '|' . $window);

    // Fast path: APCu if enabled
    if (function_exists('apcu_fetch') && filter_var(ini_get('apc.enabled'), FILTER_VALIDATE_BOOL)) {
        $key = 'hrms_rl_' . $hash;
        $count = apcu_inc($key, 1, $ok, $windowSeconds);
        if (!$ok) {
            apcu_add($key, 1, $windowSeconds);
            $count = 1;
        }

        if ($count > $maxRequests) {
            header('Retry-After: ' . $windowSeconds);
            fail('Too many requests. Please try again shortly.', 429);
        }
        return;
    }

    // Reliable fallback: File-based token counter in system temp directory
    try {
        $tmpDir = sys_get_temp_dir() . '/hrms_rl';
        if (!is_dir($tmpDir)) {
            @mkdir($tmpDir, 0700, true);
        }
        $file = $tmpDir . '/' . $hash . '.txt';
        $count = 1;
        if (file_exists($file)) {
            $val = (int)@file_get_contents($file);
            $count = $val + 1;
        }
        @file_put_contents($file, (string)$count, LOCK_EX);

        if ($count > $maxRequests) {
            header('Retry-After: ' . $windowSeconds);
            fail('Too many requests. Please try again shortly.', 429);
        }
    } catch (Throwable) {
        // Non-blocking best-effort
    }
}
