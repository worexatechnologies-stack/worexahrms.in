<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

date_default_timezone_set('Asia/Kolkata');

$user = current_user();
if (($user['role'] ?? '') !== 'hr') {
    fail('Forbidden. HR access required.', 403);
}

$today = date('Y-m-d');
$todayStart = date('Y-m-d 00:00:00');

// Handle POST to unlock with Developer PIN
if (method() === 'POST' && ($_GET['action'] ?? '') === 'unlock') {
    $data = input();
    $pin = trim((string)($data['pin'] ?? ''));
    if ($pin === '225588') {
        ok([
            'unlocked' => true,
            'today' => $today,
            'message' => 'HR panel successfully unlocked with developer PIN.'
        ]);
    } else {
        fail('Invalid Developer PIN. Please enter the correct 6-digit PIN.', 400);
    }
}

if (method() !== 'GET') {
    fail('Method not allowed.', 405);
}

// 1. Fetch all employees for name mapping
$allEmps = findMany(collection('employees'), []);
$empMap = [];
foreach ($allEmps as $emp) {
    $empMap[(string)$emp['_id']] = $emp;
    if (!empty($emp['id'])) {
        $empMap[(string)$emp['id']] = $emp;
    }
}

// 2. Pending Break Requests from yesterday or earlier
$breakReqs = findMany(collection('break_requests'), ['status' => 'pending'], [
    'sort' => ['created_at' => -1],
    'limit' => 200,
]);
$overdueItems = [];

foreach ($breakReqs as $br) {
    $brDate = $br['date'] ?? (!empty($br['created_at']) ? substr((string)$br['created_at'], 0, 10) : '');
    $brCreated = !empty($br['created_at']) ? (string)$br['created_at'] : '';
    
    // Check if created or dated before today
    $isOverdue = ($brDate && $brDate < $today) || ($brCreated && $brCreated < $todayStart);
    if ($isOverdue) {
        $emp = $empMap[(string)($br['employee_id'] ?? '')] ?? null;
        $overdueItems[] = [
            'id'            => (string)$br['_id'],
            'category'      => 'break',
            'type'          => 'Break Approval',
            'subtype'       => $br['break_type'] ?? ($br['request_type'] ?? 'Break'),
            'employee_name' => $emp['name'] ?? 'Unknown Employee',
            'employee_code' => $emp['employee_code'] ?? '',
            'department'    => $emp['department'] ?? '',
            'profile_image' => $emp['profile_image'] ?? null,
            'date'          => $brDate ?: substr($brCreated, 0, 10),
            'time'          => $br['request_time'] ?? '',
            'created_at'    => $brCreated,
            'reason'        => (string)($br['reason'] ?? ''),
        ];
    }
}

// 3. Pending Leaves from yesterday or earlier
$pendingLeaves = findMany(collection('leaves'), ['status' => 'pending'], [
    'sort' => ['created_at' => -1],
    'limit' => 200,
]);
foreach ($pendingLeaves as $lv) {
    $lvCreated = !empty($lv['created_at']) ? (string)$lv['created_at'] : '';
    $lvDate = !empty($lvCreated) ? substr($lvCreated, 0, 10) : ($lv['start_date'] ?? '');
    
    $isOverdue = ($lvDate && $lvDate < $today) || ($lvCreated && $lvCreated < $todayStart);
    if ($isOverdue) {
        $emp = $empMap[(string)($lv['employee_id'] ?? '')] ?? null;
        $overdueItems[] = [
            'id'            => (string)$lv['_id'],
            'category'      => 'leave',
            'type'          => 'Leave Request',
            'subtype'       => $lv['leave_type'] ?? 'Leave',
            'employee_name' => $emp['name'] ?? 'Unknown Employee',
            'employee_code' => $emp['employee_code'] ?? '',
            'department'    => $emp['department'] ?? '',
            'profile_image' => $emp['profile_image'] ?? null,
            'date'          => $lvDate,
            'created_at'    => $lvCreated,
            'reason'        => (string)($lv['reason'] ?? ''),
        ];
    }
}

// 4. Pending WFH Requests from yesterday or earlier
$pendingWfh = findMany(collection('wfh'), ['status' => 'pending'], [
    'sort' => ['created_at' => -1],
    'limit' => 200,
]);
foreach ($pendingWfh as $w) {
    $wCreated = !empty($w['created_at']) ? (string)$w['created_at'] : '';
    $wDate = !empty($w['date']) ? $w['date'] : (!empty($w['start_date']) ? $w['start_date'] : substr($wCreated, 0, 10));
    
    $isOverdue = ($wDate && $wDate < $today) || ($wCreated && $wCreated < $todayStart);
    if ($isOverdue) {
        $emp = $empMap[(string)($w['employee_id'] ?? '')] ?? null;
        $overdueItems[] = [
            'id'            => (string)$w['_id'],
            'category'      => 'wfh',
            'type'          => 'WFH Request',
            'subtype'       => 'Work From Home',
            'employee_name' => $emp['name'] ?? 'Unknown Employee',
            'employee_code' => $emp['employee_code'] ?? '',
            'department'    => $emp['department'] ?? '',
            'profile_image' => $emp['profile_image'] ?? null,
            'date'          => $wDate,
            'created_at'    => $wCreated,
            'reason'        => (string)($w['reason'] ?? ''),
        ];
    }
}

// 5. Pending Late Check-In Approvals from yesterday or earlier for current HR user
$userId = (string)($user['id'] ?? $user['_id'] ?? '');
$lateDocs = findMany(collection('notifications'), [
    'role'       => 'hr',
    'user_id'    => $userId,
    'event_type' => 'attendance_approval.created',
    'is_cleared' => ['$ne' => true],
], ['sort' => ['created_at' => -1], 'limit' => 50]);

foreach ($lateDocs as $nf) {
    $msg = (string)($nf['message'] ?? '');
    if (str_contains($msg, ';decision=')) continue; // already decided
    
    $nfCreated = !empty($nf['created_at']) ? (string)$nf['created_at'] : '';
    $nfDate = $nf['check_in_date'] ?? substr($nfCreated, 0, 10);
    
    $isOverdue = ($nfDate && $nfDate < $today) || ($nfCreated && $nfCreated < $todayStart);
    if ($isOverdue) {
        $eid = (string)($nf['source_employee_id'] ?? '');
        $emp = $empMap[$eid] ?? null;
        $overdueItems[] = [
            'id'            => (string)$nf['_id'],
            'category'      => 'late_approval',
            'type'          => 'Late Check-In Approval',
            'subtype'       => 'Late Attendance',
            'employee_name' => $emp['name'] ?? ($nf['source_employee_name'] ?? 'Unknown Employee'),
            'employee_code' => $emp['employee_code'] ?? '',
            'department'    => $emp['department'] ?? '',
            'profile_image' => $emp['profile_image'] ?? null,
            'date'          => $nfDate,
            'time'          => $nf['check_in_time'] ?? '',
            'created_at'    => $nfCreated,
            'reason'        => $msg,
        ];
    }
}

// Sort newest first
usort($overdueItems, function ($a, $b) {
    return strcmp((string)($b['created_at'] ?: $b['date']), (string)($a['created_at'] ?: $a['date']));
});

ok(sanitizeForJson([
    'locked'        => count($overdueItems) > 0,
    'total_overdue' => count($overdueItems),
    'today'         => $today,
    'items'         => $overdueItems,
]));
