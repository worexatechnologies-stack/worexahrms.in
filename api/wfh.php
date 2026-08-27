<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$user = current_user();
$data = input();
$id   = id_param();
$action = $_GET['action'] ?? '';

/* ─── helpers ────────────────────────────────────────────────────── */
function notifyHrWfh(array $user, array $data, string $wfhId): void
{
    $hrs = findMany(collection('users'), ['role' => 'hr']);
    if (!$hrs) return;
    [$message, $speak] = cleanHrEmployeeMessage($user['id'], 'has requested work from home');
    foreach ($hrs as $hr) {
        try {
            createNotification(
                (string)$hr['_id'],
                'hr',
                'WFH Request',
                $message,
                'info',
                [
                    'event_id' => 'wfh_request:' . $wfhId . ':created:hr:' . (string)$hr['_id'],
                    'event_type' => 'wfh_request.created',
                    'source_employee_id' => $user['id'],
                    'source_request_id' => $wfhId,
                    'speak_text' => $speak,
                    'visual_reason' => (string)($data['reason'] ?? ''),
                ]
            );
        } catch (Exception $e) {}
    }
}

function notifyEmployeeWfh(string $empId, string $wfhId, string $start, string $end, string $status): void
{
    try {
        $msg = "Your work from home request has been " . $status . ".";
        createNotification(
            $empId,
            'employee',
            'WFH ' . ucfirst($status),
            $msg,
            $status === 'approved' ? 'success' : 'error',
            [
                'event_id' => "wfh_request:{$wfhId}:{$status}:{$empId}",
                'event_type' => 'wfh_request.' . $status,
                'source_employee_id' => $empId,
                'source_request_id' => $wfhId,
                'speak_text' => $msg,
            ]
        );
    } catch (Exception $e) {}
}

function wfhIstTz(): DateTimeZone
{
    static $tz = null;
    if ($tz === null) {
        $tz = new DateTimeZone('Asia/Kolkata');
    }
    return $tz;
}

function wfhDateTimeFromValue(mixed $value, string $date): ?DateTimeImmutable
{
    $tz = wfhIstTz();

    try {
        if ($value instanceof MongoDB\BSON\UTCDateTime) {
            return DateTimeImmutable::createFromMutable($value->toDateTime()->setTimezone($tz));
        }

        if ($value instanceof DateTimeInterface) {
            return new DateTimeImmutable($value->format('Y-m-d H:i:s'), $tz);
        }

        if (is_string($value) && trim($value) !== '') {
            $raw = trim($value);
            if (preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $raw)) {
                return new DateTimeImmutable($date . ' ' . $raw, $tz);
            }
            return new DateTimeImmutable(str_replace('T', ' ', $raw), $tz);
        }
    } catch (Exception $e) {
        return null;
    }

    return null;
}

function wfhFmtTime(?DateTimeInterface $dt): ?string
{
    if (!$dt) return null;
    $immutable = $dt instanceof DateTimeImmutable
        ? $dt
        : DateTimeImmutable::createFromMutable($dt);
    return $immutable->setTimezone(wfhIstTz())->format('H:i:s');
}

function wfhIsAwayStatus(string $status): bool
{
    return in_array(strtolower($status), ['away', 'sleep'], true);
}

function wfhEmployeeLookup(string $empId): ?array
{
    try {
        return findOne(collection('employees'), ['_id' => mongoId($empId)]);
    } catch (Exception $e) {
        return null;
    }
}

function wfhBuildDailySummary(string $empId, string $date): array
{
    $tz = wfhIstTz();
    $today = (new DateTimeImmutable('now', $tz))->format('Y-m-d');
    $dayStart = new DateTimeImmutable($date . ' 00:00:00', $tz);
    $dayEnd = $date === $today
        ? new DateTimeImmutable('now', $tz)
        : new DateTimeImmutable($date . ' 23:59:59', $tz);

    $updates = findMany(collection('wfh_status_updates'), [
        'employee_id' => $empId,
        'date'        => $date,
    ], [
        'sort' => ['created_at' => 1],
    ]);

    $events = [];
    foreach ($updates as $update) {
        $dt = wfhDateTimeFromValue($update['created_at'] ?? null, $date);
        if (!$dt) continue;

        if ($dt < $dayStart) $dt = $dayStart;
        if ($dt > $dayEnd) $dt = $dayEnd;

        $events[] = [
            'id'            => isset($update['_id']) ? (string)$update['_id'] : '',
            'status'        => strtolower((string)($update['status'] ?? 'active')),
            'custom_status' => (string)($update['custom_status'] ?? ''),
            'dt'            => $dt,
        ];
    }

    usort($events, fn($a, $b) => $a['dt'] <=> $b['dt']);

    $totalActive = 0;
    $totalAway = 0;
    $idleEvents = [];
    $firstActiveAt = null;
    $lastActivityAt = null;
    $timeline = [];

    foreach ($events as $index => $event) {
        $from = $event['dt'];
        $to = $events[$index + 1]['dt'] ?? $dayEnd;
        if ($to < $from) $to = $from;

        $duration = max(0, $to->getTimestamp() - $from->getTimestamp());
        $isAway = wfhIsAwayStatus($event['status']);

        $timeline[] = [
            'id'            => $event['id'],
            'status'        => $event['status'],
            'custom_status' => $event['custom_status'],
            'created_at'    => wfhFmtTime($from),
        ];

        if ($isAway) {
            $totalAway += $duration;
            $idleEvents[] = [
                'from'     => wfhFmtTime($from),
                'to'       => wfhFmtTime($to),
                'duration' => $duration,
                'reason'   => $event['custom_status'],
            ];
            continue;
        }

        $totalActive += $duration;
        if ($firstActiveAt === null) {
            $firstActiveAt = $from;
        }
        $lastActivityAt = $from;
    }

    $employee = wfhEmployeeLookup($empId);
    $observed = $totalActive + $totalAway;
    $workdaySeconds = 8 * 60 * 60;

    return [
        'employee_id'           => $empId,
        'employee_name'         => $employee['name'] ?? '',
        'employee_code'         => $employee['employee_code'] ?? '',
        'date'                  => $date,
        'total_active_seconds'  => $totalActive,
        'total_away_seconds'    => $totalAway,
        'active_percent'        => $observed > 0 ? (int)round(($totalActive / $observed) * 100) : 0,
        'target_active_percent' => $workdaySeconds > 0 ? (int)min(100, round(($totalActive / $workdaySeconds) * 100)) : 0,
        'idle_events_count'     => count($idleEvents),
        'idle_events'           => $idleEvents,
        'first_active_at'       => wfhFmtTime($firstActiveAt),
        'last_activity_at'      => wfhFmtTime($lastActivityAt),
        'timeline'              => $timeline,
    ];
}

/* ─── POST (submit WFH status update) ─────────────────────────────── */
if (method() === 'POST' && $action === 'submit_status') {
    require_fields($data, ['status', 'custom_status']);
    
    $empId = $user['id'];
    $empName = $user['name'];
    $dateStr = date('Y-m-d');
    $submittedStatus = trim($data['status']);
    
    // When user sets status to active, clear any paused state on attendance
    if ($submittedStatus === 'active') {
        $attendance = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $dateStr]);
        if ($attendance && !empty($attendance['is_paused'])) {
            updateOne(collection('attendance'), ['_id' => $attendance['_id']], [
                'is_paused'    => false,
                'pause_reason' => null,
                'paused_at'    => null,
            ]);
        }
    }
    
    try {
        $result = insertOne(collection('wfh_status_updates'), [
            'employee_id'   => $empId,
            'employee_name' => $empName,
            'status'        => $submittedStatus,
            'custom_status' => trim($data['custom_status']),
            'date'          => $dateStr,
            'created_at'    => new MongoDB\BSON\UTCDateTime(time() * 1000),
        ]);
        ok(['id' => (string)$result['_id'], 'resumed' => ($submittedStatus === 'active')], 'Status updated successfully.', 201);
    } catch (Exception $e) {
        fail('Failed to update status. Please try again.', 500);
    }
}

/* ─── GET (my status updates for today) ───────────────────────────── */
if (method() === 'GET' && $action === 'my_status_today') {
    $today = date('Y-m-d');
    $timeline = findMany(collection('wfh_status_updates'), [
        'employee_id' => $user['id'],
        'date'        => $today
    ], [
        'sort' => ['created_at' => -1]
    ]);
    $latestStatus = 'active';
    $pauseReason = null;
    foreach ($timeline as &$item) {
        $item['id'] = (string)$item['_id'];
        unset($item['_id']);
        if (isset($item['created_at']) && $item['created_at'] instanceof MongoDB\BSON\UTCDateTime) {
            $item['created_at'] = $item['created_at']->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('H:i:s');
        }
    }
    unset($item);
    if (!empty($timeline)) {
        $latestStatus = $timeline[0]['status'] ?? 'active';
        $pauseReason  = $timeline[0]['pause_reason'] ?? $timeline[0]['reason'] ?? null;
    }
    $att = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if ($att && !empty($att['is_paused'])) {
        $latestStatus = 'away';
        $pauseReason = $att['pause_reason'] ?? ($att['is_paused'] === true ? 'System Paused' : null);
    }
    ok([
        'timeline'     => $timeline,
        'status'       => $latestStatus,
        'pause_reason' => $pauseReason,
    ]);
}

/* ─── GET (live WFH status monitor for HR) ────────────────────────── */
if (method() === 'GET' && $action === 'live_status') {
    if ($user['role'] !== 'hr') fail('Only HR can monitor live status.', 403);
    
    $today = date('Y-m-d');
    
    // Find all WFH requests where status is approved and today is between start and end dates
    $activeWfhs = findMany(collection('wfh'), [
        'status'     => 'approved',
        'start_date' => ['$lte' => $today],
        'end_date'   => ['$gte' => $today],
    ]);
    
    $liveWfhs = [];
    foreach ($activeWfhs as $wfh) {
        $empId = $wfh['employee_id'];
        $emp = findOne(collection('employees'), ['_id' => mongoId($empId)]);
        if (!$emp) continue;
        
        // Find latest status today
        $updates = findMany(collection('wfh_status_updates'), [
            'employee_id' => $empId,
            'date'        => $today
        ], [
            'sort'  => ['created_at' => -1],
            'limit' => 1
        ]);
        $latest = !empty($updates) ? $updates[0] : null;
        
        // Find all status updates today
        $timeline = findMany(collection('wfh_status_updates'), [
            'employee_id' => $empId,
            'date'        => $today
        ], [
            'sort'  => ['created_at' => 1] // ascending
        ]);
        
        foreach ($timeline as &$item) {
            $item['id'] = (string)$item['_id'];
            unset($item['_id']);
            if (isset($item['created_at']) && $item['created_at'] instanceof MongoDB\BSON\UTCDateTime) {
                $item['created_at'] = $item['created_at']->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('H:i:s');
            }
        }
        unset($item);
        
        $formattedLastUpdated = null;
        if ($latest && isset($latest['created_at']) && $latest['created_at'] instanceof MongoDB\BSON\UTCDateTime) {
            $formattedLastUpdated = $latest['created_at']->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('H:i:s');
        }

        // Fetch attendance record for timer state
        $attendance = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $today]);
        $isCheckedIn = !empty($attendance['check_in']);
        $isCheckedOut = !empty($attendance['check_out']);
        $timerPaused = !empty($attendance['hr_timer_paused']) || !empty($attendance['is_paused']);
        $checkInTime = $attendance['check_in'] ?? null;
        $checkOutTime = $attendance['check_out'] ?? null;
        $pauseReason = $attendance['hr_pause_reason'] ?? $attendance['pause_reason'] ?? null;

        // Fetch sleep mode request for today
        $sleepReq = findOne(collection('wfh_sleep_requests'), ['employee_id' => $empId, 'date' => $today], ['sort' => ['created_at' => -1]]);
        $sleepRequestData = null;
        if ($sleepReq) {
            $sleepRequestData = [
                'id'         => (string)$sleepReq['_id'],
                'reason'     => $sleepReq['reason'] ?? '',
                'status'     => $sleepReq['status'] ?? 'pending',
                'created_at' => isset($sleepReq['created_at']) && $sleepReq['created_at'] instanceof MongoDB\BSON\UTCDateTime
                    ? $sleepReq['created_at']->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('H:i:s')
                    : ''
            ];
        }
        
        $liveWfhs[] = [
            'employee_id'          => $empId,
            'employee_name'        => $emp['name'] ?? 'Unknown',
            'employee_code'        => $emp['employee_code'] ?? '',
            'branch'               => $emp['branch'] ?? '',
            'wfh_request_id'       => (string)$wfh['_id'],
            'start_date'           => $wfh['start_date'],
            'end_date'             => $wfh['end_date'],
            'latest_status'        => $latest ? $latest['status'] : 'offline',
            'latest_custom_status' => $latest ? $latest['custom_status'] : 'Not checked-in today',
            'last_updated'         => $formattedLastUpdated,
            'timeline'             => $timeline,
            'is_checked_in'        => $isCheckedIn,
            'is_checked_out'       => $isCheckedOut,
            'timer_paused'         => $timerPaused,
            'check_in_time'        => $checkInTime,
            'check_out_time'       => $checkOutTime,
            'pause_reason'         => $pauseReason,
            'sleep_request'        => $sleepRequestData,
        ];
    }
    
    ok(['live_status' => $liveWfhs]);
}

/* ─── GET (wfh requests list) ─────────────────────────────────────── */
if (method() === 'GET') {
    $page    = max(1, (int) ($_GET['page'] ?? 1));
    $perPage = min(100, max(10, (int) ($_GET['per_page'] ?? 50)));
    $skip    = ($page - 1) * $perPage;

    if ($user['role'] === 'hr') {
        $statusFilter = $_GET['status'] ?? '';
        $filter = $statusFilter !== '' ? ['status' => $statusFilter] : [];
        $total  = countDocs(collection('wfh'), $filter);
        $requests = findMany(collection('wfh'), $filter, [
            'sort'  => ['created_at' => -1],
            'skip'  => $skip,
            'limit' => $perPage,
        ]);

        $empIds = array_values(array_unique(array_filter(array_column($requests, 'employee_id'))));
        $empMap = [];
        if ($empIds) {
            $emps = findMany(collection('employees'), ['_id' => ['$in' => array_map(fn($id) => mongoId($id), $empIds)]]);
            foreach ($emps as $e) { $empMap[(string)$e['_id']] = $e; }
        }
        foreach ($requests as &$r) {
            $r['id'] = (string) $r['_id'];
            unset($r['_id']);
            $emp = $empMap[$r['employee_id']] ?? null;
            $r['employee_name'] = $emp['name'] ?? 'Unknown';
            $r['employee_code'] = $emp['employee_code'] ?? '';
            $r['branch']        = $emp['branch'] ?? '';
            if (isset($r['created_at']) && $r['created_at'] instanceof MongoDB\BSON\UTCDateTime) {
                $r['created_at'] = $r['created_at']->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
            }
        }
        unset($r);
        ok(['wfh_requests' => $requests, 'pagination' => ['page' => $page, 'total' => $total, 'per_page' => $perPage]]);
    }

    // Employee: own requests
    $filter = ['employee_id' => $user['id']];
    $total  = countDocs(collection('wfh'), $filter);
    $requests = findMany(collection('wfh'), $filter, [
        'sort'  => ['created_at' => -1],
        'skip'  => $skip,
        'limit' => $perPage,
    ]);
    foreach ($requests as &$r) {
        $r['id'] = (string) $r['_id'];
        unset($r['_id']);
        if (isset($r['created_at']) && $r['created_at'] instanceof MongoDB\BSON\UTCDateTime) {
            $r['created_at'] = $r['created_at']->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
        }
    }
    unset($r);
    ok(['wfh_requests' => $requests, 'pagination' => ['page' => $page, 'total' => $total, 'per_page' => $perPage]]);
}

/* ─── POST (submit WFH request) ───────────────────────────────────── */
if (method() === 'POST') {
    require_fields($data, ['start_date', 'end_date', 'reason']);
    $empId = ($user['role'] === 'hr' && !empty($data['employee_id']))
        ? (string) $data['employee_id']
        : $user['id'];

    try {
        $result = insertOne(collection('wfh'), [
            'employee_id' => $empId,
            'start_date'  => $data['start_date'],
            'end_date'    => $data['end_date'],
            'reason'      => trim($data['reason']),
            'status'      => 'pending',
            'created_at'  => new MongoDB\BSON\UTCDateTime(time() * 1000),
        ]);
    } catch (Exception $e) {
        fail('Failed to submit work from home request. Please try again.', 500);
    }

    notifyHrWfh($user, $data, (string)$result['_id']);
    ok(['id' => (string) $result['_id']], 'Work from home request submitted.', 201);
}

/* ─── PUT (HR approve/reject) ─────────────────────────────────────── */
if (method() === 'PUT' && $id) {
    if ($user['role'] !== 'hr') fail('Only HR can update WFH request status.', 403);
    require_fields($data, ['status']);
    if (!in_array($data['status'], ['approved', 'rejected'], true)) fail('Invalid status.', 422);

    $wfh = findOne(collection('wfh'), ['_id' => mongoId((string) $id)]);
    if (!$wfh) fail('Work from home request not found.', 404);
    if (($wfh['status'] ?? '') === $data['status']) {
        ok(null, 'Work from home request already ' . $data['status'] . '.');
    }

    updateOne(collection('wfh'), ['_id' => mongoId((string) $id)], ['status' => $data['status']]);

    if ($data['status'] === 'approved') {
        $today = date('Y-m-d');
        if ($today >= $wfh['start_date'] && $today <= $wfh['end_date']) {
            $attRec = findOne(collection('attendance'), ['employee_id' => $wfh['employee_id'], 'date' => $today]);
            if ($attRec) {
                updateOne(collection('attendance'), ['_id' => $attRec['_id']], [
                    'work_mode' => 'wfh',
                    'mode' => 'wfh'
                ]);
            }
        }
    }

    notifyEmployeeWfh(
        $wfh['employee_id'],
        (string)$wfh['_id'],
        $wfh['start_date'],
        $wfh['end_date'],
        $data['status']
    );
    ok(null, 'Work from home request ' . $data['status'] . '.');
}

/* ─── POST (HR force stop / checkout WFH employee) ─────────────────── */
if (method() === 'POST' && $action === 'hr_force_stop_wfh') {
    if ($user['role'] !== 'hr') fail('Only HR can force stop WFH.', 403);
    $data = input();
    require_fields($data, ['employee_id']);

    $empId = (string)$data['employee_id'];
    $reason = substr(trim((string)($data['reason'] ?? 'Stopped by HR')), 0, 200);
    $today = date('Y-m-d');
    $nowStr = date('H:i:s');
    $nowDateTime = date('Y-m-d H:i:s');

    $emp = findOne(collection('employees'), ['_id' => mongoId($empId)]);
    if (!$emp) fail('Employee not found.', 404);

    $rec = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $today]);
    if (!$rec) fail('Employee has not checked in today.', 404);
    if (!empty($rec['check_out'])) fail('Employee already checked out.', 400);

    // If currently paused, calculate break time
    $totalBreakSecs = (int)($rec['total_break_seconds'] ?? 0);
    if (!empty($rec['break_start_time'])) {
        $breakStartTs = strtotime($today . ' ' . $rec['break_start_time']);
        $totalBreakSecs += max(0, time() - ($breakStartTs ?: time()));
    }

    // Calculate working hours
    $checkInTs = strtotime($today . ' ' . $rec['check_in']);
    $nowTs = time();
    $totalSecs = max(0, $nowTs - $checkInTs);
    $netSecs = max(0, $totalSecs - $totalBreakSecs);
    $hours = (int)floor($netSecs / 3600);
    $mins = (int)floor(($netSecs % 3600) / 60);
    $workingHours = sprintf('%02d:%02d', $hours, $mins);

    updateOne(collection('attendance'), ['_id' => $rec['_id']], [
        'check_out'           => $nowStr,
        'working_hours'       => $workingHours,
        'total_break_seconds' => $totalBreakSecs,
        'break_start_time'    => null,
        'hr_timer_paused'     => false,
        'is_paused'           => false,
        'hr_force_stopped'    => true,
        'hr_force_stop_reason'=> $reason,
        'hr_force_stop_by'    => $user['id'],
        'hr_force_stop_at'    => $nowDateTime,
    ]);

    updateOne(collection('employees'), ['_id' => mongoId($empId)], [
        'is_paused' => false,
        'status' => 'inactive'
    ]);

    // Submit a WFH status update to mark forced stop
    try {
        insertOne(collection('wfh_status_updates'), [
            'employee_id'   => $empId,
            'employee_name' => $emp['name'] ?? 'Unknown',
            'status'        => 'away',
            'custom_status' => '🛑 WFH Force-Stopped by HR: ' . $reason,
            'date'          => $today,
            'created_at'    => new MongoDB\BSON\UTCDateTime(time() * 1000),
        ]);
    } catch (Exception $e) {}

    $empName = $emp['name'] ?? 'Employee';
    $stopId = (string)$rec['_id'] . '_stop_' . str_replace(['-', ' ', ':'], '', $nowDateTime);

    // Notify the employee
    try {
        createNotification(
            $empId,
            'employee',
            'WFH Force-Stopped',
            'Your WFH session has been stopped by HR. Reason: ' . $reason,
            'error',
            [
                'event_id'    => "wfh_force_stop_emp:{$empId}:{$stopId}",
                'event_type'  => 'wfh_force_stop.created',
                'source_employee_id' => $empId,
                'speak_text'  => 'Your WFH session has been stopped by HR.',
            ]
        );
    } catch (Exception $e) {}

    // Notify HR activity log
    try {
        createNotification('', 'hr', 'WFH Force-Stopped', "{$empName}'s WFH session was force-stopped. Reason: {$reason}", 'warning', [
            'event_id'    => "wfh_force_stop:{$empId}:{$stopId}",
            'event_type'  => 'wfh_force_stop.created',
            'source_employee_id' => $empId,
            'speak_text'  => "{$empName}'s WFH session was force-stopped.",
        ]);
    } catch (Exception $e) {}

    ok(null, "WFH session for {$empName} has been force-stopped.");
}

/* ─── POST (Employee Request Sleep Mode) ───────────────────────────── */
if (method() === 'POST' && $action === 'request_sleep_mode') {
    require_fields($data, ['reason']);
    $empId = $user['id'];
    $empName = $user['name'];
    $today = date('Y-m-d');
    $nowStr = date('H:i:s');
    $nowDateTime = date('Y-m-d H:i:s');
    $reason = trim((string)$data['reason']);

    $rec = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $today]);
    if (!$rec) fail('You must check in first before requesting Sleep Mode.', 400);
    if (!empty($rec['check_out'])) fail('You are already checked out today.', 400);

    // Pause the timer immediately
    updateOne(collection('attendance'), ['_id' => $rec['_id']], [
        'break_start_time'    => $nowStr,
        'hr_timer_paused'     => true,
        'hr_pause_started_at' => $nowDateTime,
        'hr_pause_reason'     => 'Sleep Mode Requested: ' . $reason,
        'is_paused'           => true,
    ]);

    // Save sleep mode request
    $reqResult = insertOne(collection('wfh_sleep_requests'), [
        'employee_id'   => $empId,
        'employee_name' => $empName,
        'date'          => $today,
        'reason'        => $reason,
        'status'        => 'pending',
        'created_at'    => new MongoDB\BSON\UTCDateTime(time() * 1000),
    ]);

    // Submit status log
    try {
        insertOne(collection('wfh_status_updates'), [
            'employee_id'   => $empId,
            'employee_name' => $empName,
            'status'        => 'sleep',
            'custom_status' => '😴 Sleep Mode Requested: ' . $reason,
            'date'          => $today,
            'created_at'    => new MongoDB\BSON\UTCDateTime(time() * 1000),
        ]);
    } catch (Exception $e) {}

    // Notify HR
    try {
        createNotification('', 'hr', 'Sleep Mode Request', "{$empName} requested Sleep Mode: {$reason}", 'info', [
            'event_id'           => 'sleep_mode_req:' . (string)$reqResult['_id'],
            'event_type'         => 'sleep_mode.requested',
            'source_employee_id' => $empId,
            'speak_text'         => "{$empName} requested Sleep Mode.",
        ]);
    } catch (Exception $e) {}

    ok(['id' => (string)$reqResult['_id']], 'Sleep mode requested. HR has been notified.');
}

/* ─── POST (HR Decide Sleep Mode: Approve / Reject) ────────────────── */
if (method() === 'POST' && $action === 'decide_sleep_mode') {
    if ($user['role'] !== 'hr') fail('Only HR can approve/reject sleep mode requests.', 403);
    require_fields($data, ['employee_id', 'status']);
    $empId = (string)$data['employee_id'];
    $decision = strtolower(trim((string)$data['status'])); // approved or rejected
    if (!in_array($decision, ['approved', 'rejected'], true)) fail('Invalid decision status.', 422);

    $today = date('Y-m-d');
    $sleepReq = findOne(collection('wfh_sleep_requests'), ['employee_id' => $empId, 'date' => $today, 'status' => 'pending']);
    if ($sleepReq) {
        updateOne(collection('wfh_sleep_requests'), ['_id' => $sleepReq['_id']], [
            'status'      => $decision,
            'decided_by'  => $user['id'],
            'decided_at'  => date('Y-m-d H:i:s'),
        ]);
    }

    $emp = findOne(collection('employees'), ['_id' => mongoId($empId)]);
    $empName = $emp['name'] ?? 'Employee';
    $rec = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $today]);

    if ($decision === 'approved') {
        // Keep timer paused, log approved status
        try {
            insertOne(collection('wfh_status_updates'), [
                'employee_id'   => $empId,
                'employee_name' => $empName,
                'status'        => 'sleep',
                'custom_status' => '✅ Sleep Mode Approved by HR',
                'date'          => $today,
                'created_at'    => new MongoDB\BSON\UTCDateTime(time() * 1000),
            ]);
        } catch (Exception $e) {}

        notifyEmployee($empId, 'Sleep Mode Approved', 'Your sleep mode request has been approved by HR.', 'success');
        ok(null, "Sleep mode approved for {$empName}.");
    } else {
        // Rejected: Resume timer
        if ($rec && !empty($rec['break_start_time'])) {
            $breakStartTs = strtotime($today . ' ' . $rec['break_start_time']);
            $elapsedSecs = max(0, time() - ($breakStartTs ?: time()));
            $newTotal = (int)($rec['total_break_seconds'] ?? 0) + $elapsedSecs;

            updateOne(collection('attendance'), ['_id' => $rec['_id']], [
                'break_start_time'    => null,
                'total_break_seconds' => $newTotal,
                'hr_timer_paused'     => false,
                'is_paused'           => false,
                'resumed_at'          => date('Y-m-d H:i:s'),
                'resumed_by'          => $user['id'],
            ]);
        }

        try {
            insertOne(collection('wfh_status_updates'), [
                'employee_id'   => $empId,
                'employee_name' => $empName,
                'status'        => 'active',
                'custom_status' => '❌ Sleep Mode Rejected by HR — Timer Resumed',
                'date'          => $today,
                'created_at'    => new MongoDB\BSON\UTCDateTime(time() * 1000),
            ]);
        } catch (Exception $e) {}

        notifyEmployee($empId, 'Sleep Mode Rejected', 'Your sleep mode request was rejected. Timer has been resumed.', 'warning');
        ok(null, "Sleep mode rejected for {$empName}. Timer resumed.");
    }
}

fail('Method not allowed.', 405);
