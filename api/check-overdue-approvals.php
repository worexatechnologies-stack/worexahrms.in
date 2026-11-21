<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';

date_default_timezone_set('Asia/Kolkata');

$user = current_user();
if (($user['role'] ?? '') !== 'hr') {
    fail('Forbidden. HR access required.', 403);
}

$today = date('Y-m-d');

// Unlock endpoint fallback (returns success immediately)
if (method() === 'POST' && ($_GET['action'] ?? '') === 'unlock') {
    ok([
        'unlocked' => true,
        'today' => $today,
        'message' => 'HR panel successfully unlocked.'
    ]);
}

if (method() !== 'GET') {
    fail('Method not allowed.', 405);
}

// Overdue lockout is completely disabled
ok([
    'locked' => false,
    'total_overdue' => 0,
    'today' => $today,
    'items' => [],
    'categories' => [
        'break_requests' => 0,
        'late_checkins' => 0,
        'checkout_undo' => 0,
        'leaves' => 0,
        'wfh' => 0,
    ],
]);
