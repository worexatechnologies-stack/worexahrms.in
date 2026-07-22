<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';
$user = current_user();
rate_limit('dashboard:' . method(), 40, 60, $user['id'] ?? '');
date_default_timezone_set('Asia/Kolkata');
closeAllOpenSessions();

function dashboardAttendanceSettings(): array
{
    return [
        'checkin_open'         => '09:00',
        'checkin_close'        => '10:00',
        'checkout_open'        => '18:30',
        'checkout_close'       => '19:00',
        'lunch_start'          => '13:30',
        'lunch_end'            => '14:30',
        'lunch_duration_min'   => 60,
        'evening_start'        => '16:30',
        'evening_end'          => '17:00',
        'evening_duration_min' => 30,
        'late_after'           => '09:45',
    ];
}

// notifyHr is defined in attendance.php but needed here too
function dashNotifyHr(string $title, string $msg, string $type = 'info'): void
{
    $hrs = findMany(collection('users'), ['role' => 'hr']);
    foreach ($hrs as $hr) {
        try {
            insertOne(collection('notifications'), [
                'user_id'    => (string) $hr['_id'],
                'role'       => 'hr',
                'title'      => $title,
                'message'    => $msg,
                'type'       => $type,
                'is_read'    => false,
                'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
            ]);
        } catch (Exception) {}
    }
}

// Normalise date fields stored as MongoDB UTCDateTime or plain string
function dashFmtDate(mixed $val): string
{
    if ($val instanceof MongoDB\BSON\UTCDateTime) {
        return $val->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d');
    }
    // Handle BSONDocument objects (convert to array first)
    if ($val instanceof MongoDB\Model\BSONDocument) {
        $val = (array)$val;
    }
    // Handle arrays with $date field (from imported JSON)
    if (is_array($val) && isset($val['$date'])) {
        try {
            $dateTime = new DateTime($val['$date']);
            return $dateTime->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d');
        } catch (Exception) {
            return '';
        }
    }
    // Handle DateTime objects
    if ($val instanceof DateTime) {
        return $val->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d');
    }
    // Fallback to string conversion
    if (is_object($val)) {
        return '';
    }
    return (string)($val ?? '');
}

function dashFormatWorkedDuration(int $seconds): string
{
    $seconds = max(0, $seconds);
    return sprintf(
        '%02d:%02d:%02d',
        (int)floor($seconds / 3600),
        (int)floor(($seconds % 3600) / 60),
        $seconds % 60
    );
}

function dashEnrichWorkedDuration(array $rec): array
{
    if (!empty($rec['is_paused']) && ($rec['pause_reason'] ?? '') === 'Auto-Paused: System Sleep / Inactivity') {
        $rec['is_paused'] = false;
        $rec['hr_timer_paused'] = false;
        $rec['paused_at'] = null;
        $rec['pause_reason'] = null;
        $rec['break_start_time'] = null;
    }

    $now = time();
    $lastResumed = strtotime($rec['last_resumed_at'] ?? $rec['clock_in_at'] ?? 'now');
    $delta = max(0, $now - $lastResumed);

    $workSecs = (int)($rec['accumulated_work_seconds'] ?? 0);
    $meetingSecs = (int)($rec['accumulated_meeting_seconds'] ?? 0);
    $lunchSecs = (int)($rec['accumulated_lunch_seconds'] ?? 0);
    $breakSecs = (int)($rec['accumulated_break_seconds'] ?? 0);
    $extendedSecs = (int)($rec['accumulated_extended_break_seconds'] ?? 0);

    $wfhSecs = (int)($rec['wfh_working_seconds'] ?? 0);
    $officeSecs = (int)($rec['office_working_seconds'] ?? 0);

    $activeType = $rec['active_activity_type'] ?? 'working';
    $isCheckedOut = !empty($rec['is_checked_out']) || !empty($rec['check_out']);

    if (!$isCheckedOut) {
        if ($activeType === 'working') {
            $workSecs += $delta;
            if (($rec['work_mode'] ?? 'office') === 'wfh') {
                $wfhSecs += $delta;
            } else {
                $officeSecs += $delta;
            }
        } elseif ($activeType === 'meeting') {
            $meetingSecs += $delta;
            if (($rec['work_mode'] ?? 'office') === 'wfh') {
                $wfhSecs += $delta;
            } else {
                $officeSecs += $delta;
            }
        } elseif ($activeType === 'lunch') {
            $lunchSecs += $delta;
        } elseif ($activeType === 'break') {
            $breakSecs += $delta;
        }
    }

    $productiveSecs = $workSecs + $meetingSecs;
    $totalSession = $workSecs + $meetingSecs + $lunchSecs + $breakSecs;

    $rec['live_work_seconds'] = $workSecs;
    $rec['live_meeting_seconds'] = $meetingSecs;
    $rec['live_lunch_seconds'] = $lunchSecs;
    $rec['live_break_seconds'] = $breakSecs;
    $rec['live_extended_break_seconds'] = $extendedSecs;
    $rec['live_wfh_working_seconds'] = $wfhSecs;
    $rec['live_office_working_seconds'] = $officeSecs;
    $rec['live_productive_working_seconds'] = $productiveSecs;
    $rec['live_total_session_seconds'] = $totalSession;

    $rec['worked_seconds'] = $productiveSecs;
    $rec['total_break_seconds'] = $lunchSecs + $breakSecs;
    $rec['net_working_hours'] = dashFormatWorkedDuration($productiveSecs);
    $rec['working_hours'] = $rec['net_working_hours'];

    return $rec;
}

function dashStartBreakSession(array $rec, string $empId, string $breakType, int $durationMinutes, int $startTs): ?array
{
    $active = findOne(collection('break_sessions'), [
        'employee_id' => $empId,
        'attendance_id' => (string)$rec['_id'],
        'status' => ['$in' => ['active', 'extended']]
    ]);
    if ($active) return null;

    $existing = findOne(collection('break_sessions'), [
        'employee_id' => $empId,
        'attendance_id' => (string)$rec['_id'],
        'break_type' => $breakType
    ]);
    if ($existing) return null;

    $expectedEndAt = $startTs + ($durationMinutes * 60);
    $session = [
        'employee_id' => $empId,
        'attendance_id' => (string)$rec['_id'],
        'break_type' => $breakType,
        'started_at' => date('Y-m-d H:i:s', $startTs),
        'expected_end_at' => date('Y-m-d H:i:s', $expectedEndAt),
        'ended_at' => null,
        'extension_minutes' => 0,
        'extension_reason' => null,
        'extended_by' => null,
        'extended_at' => null,
        'late_start_minutes' => 0,
        'late_return_minutes' => 0,
        'status' => 'active',
        'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s')
    ];
    $saved = insertOne(collection('break_sessions'), $session);
    updateOne(collection('attendance'), ['_id' => $rec['_id']], ['break_start_time' => date('H:i:s', $startTs)]);
    $session['_id'] = $saved['_id'];
    return $session;
}

function dashCompleteBreakSession(array $rec, array $session, int $endTs): void
{
    $startedAtTs = strtotime((string)$session['started_at']);
    if (!$startedAtTs) return;
    $elapsedSecs = max(0, $endTs - $startedAtTs);
    updateOne(collection('break_sessions'), ['_id' => $session['_id']], [
        'ended_at' => date('Y-m-d H:i:s', $endTs),
        'status' => 'completed',
        'updated_at' => date('Y-m-d H:i:s')
    ]);
    updateOne(collection('attendance'), ['_id' => $rec['_id']], [
        'break_start_time' => null,
        'total_break_seconds' => (int)($rec['total_break_seconds'] ?? 0) + $elapsedSecs
    ]);
}

function dashBuildAttendanceChart(string $range): array
{
    $range = trim(strtolower($range));
    if (!in_array($range, ['day', 'week', 'month'], true)) {
        $range = 'month';
    }

    $today = new DateTime('today');
    $chart = [];

    if ($range === 'day') {
        $days = [];
        for ($i = 6; $i >= 0; $i--) {
            $dt = (clone $today)->modify("-{$i} days");
            $key = $dt->format('Y-m-d');
            $days[$key] = [
                'label' => $dt->format('d M'),
                'present' => 0,
                'late' => 0,
                'absent' => 0,
                'total' => 0,
            ];
        }

        $from = array_key_first($days);
        $att = findMany(collection('attendance'), ['date' => ['$gte' => $from]]);
        foreach ($att as $row) {
            $date = (string)($row['date'] ?? '');
            if (!isset($days[$date])) continue;
            $status = (string)($row['status'] ?? '');
            if ($status === 'present') $days[$date]['present']++;
            if ($status === 'late') $days[$date]['late']++;
            if ($status === 'absent') $days[$date]['absent']++;
            $days[$date]['total']++;
        }

        return array_values($days);
    }

    if ($range === 'week') {
        $weeks = [];
        for ($i = 7; $i >= 0; $i--) {
            $dt = (clone $today)->modify("-{$i} weeks");
            $key = $dt->format('o-W');
            $weeks[$key] = [
                'label' => 'W' . $dt->format('W'),
                'present' => 0,
                'late' => 0,
                'absent' => 0,
                'total' => 0,
            ];
        }

        $start = (clone $today)->modify('-7 weeks')->format('Y-m-d');
        $att = findMany(collection('attendance'), ['date' => ['$gte' => $start]]);
        foreach ($att as $row) {
            $date = (string)($row['date'] ?? '');
            $dt = date_create($date);
            if (!$dt) continue;
            $key = $dt->format('o-W');
            if (!isset($weeks[$key])) continue;
            $status = (string)($row['status'] ?? '');
            if ($status === 'present') $weeks[$key]['present']++;
            if ($status === 'late') $weeks[$key]['late']++;
            if ($status === 'absent') $weeks[$key]['absent']++;
            $weeks[$key]['total']++;
        }

        return array_values($weeks);
    }

    $months = [];
    for ($i = 5; $i >= 0; $i--) {
        $dt = (clone $today)->modify("-{$i} months");
        $key = $dt->format('Y-m');
        $months[$key] = [
            'label' => $dt->format('M'),
            'present' => 0,
            'late' => 0,
            'absent' => 0,
            'total' => 0,
        ];
    }

    $start = (clone $today)->modify('-5 months')->format('Y-m-d');
    $att = findMany(collection('attendance'), ['date' => ['$gte' => $start]]);
    foreach ($att as $row) {
        $date = (string)($row['date'] ?? '');
        $dt = date_create($date);
        if (!$dt) continue;
        $key = $dt->format('Y-m');
        if (!isset($months[$key])) continue;
        $status = (string)($row['status'] ?? '');
        if ($status === 'present') $months[$key]['present']++;
        if ($status === 'late') $months[$key]['late']++;
        if ($status === 'absent') $months[$key]['absent']++;
        $months[$key]['total']++;
    }

    return array_values($months);
}

function dashSyncAutoBreaksForEmployee(string $empId): void
{
    $today = date('Y-m-d');
    $rec = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $today]);
    if (!$rec || empty($rec['check_in']) || !empty($rec['check_out'])) return;

    $cfg = dashboardAttendanceSettings();
    $nowTs = time();
    $active = findOne(collection('break_sessions'), [
        'employee_id' => $empId,
        'attendance_id' => (string)$rec['_id'],
        'status' => ['$in' => ['active', 'extended']]
    ]);
    if ($active) return;

    foreach ([
        'lunch' => ['start' => $cfg['lunch_start'], 'duration' => (int)$cfg['lunch_duration_min']],
        'evening' => ['start' => $cfg['evening_start'], 'duration' => (int)$cfg['evening_duration_min']],
    ] as $type => $rule) {
        $startTs = strtotime($today . ' ' . $rule['start'] . ':00');
        if (!$startTs || $nowTs < $startTs) continue;
        if (findOne(collection('break_sessions'), ['employee_id' => $empId, 'attendance_id' => (string)$rec['_id'], 'break_type' => $type])) continue;
        dashStartBreakSession($rec, $empId, $type, $rule['duration'], $startTs);
        break;
    }
}

$today = date('Y-m-d');

if ($user['role'] === 'hr') {
    // 1. Attendance Settings
    $st = findOne(collection('attendance_settings'), ['setting_key' => 'lunch_end']);
    $lunchEnd = $st['setting_value'] ?? '14:30';
    $lunchEndTs = strtotime($lunchEnd . ':00');

    // 2. Active Employees & Breaks (Fix N+1)
    $activeStatusFilter = ['status' => ['$regex' => '^active$', '$options' => 'i']];
    $inactiveStatusFilter = ['status' => ['$regex' => '^inactive$', '$options' => 'i']];
    $activeEmployees = findMany(collection('employees'), $activeStatusFilter);
    $activeEmpMap = [];
    foreach ($activeEmployees as $emp) {
        $activeEmpMap[(string)$emp['_id']] = $emp['name'];
        if (!empty($emp['id'])) $activeEmpMap[(string)$emp['id']] = $emp['name'];
    }

    $activeBreaks = findMany(collection('attendance'), [
        'date' => $today,
        'break_start_time' => ['$ne' => null]
    ]);

    $lunchRequests = findMany(collection('break_requests'), [
        'date' => $today,
        'status' => 'approved',
        'request_type' => 'lunch_break'
    ]);
    
    $extendMins = [];
    foreach ($lunchRequests as $req) {
        $extendMins[(string)$req['employee_id']] = (int)($req['extend_minutes'] ?? 0);
    }

    foreach ($activeBreaks as $ab) {
        $empIdStr = (string)$ab['employee_id'];
        if (!isset($activeEmpMap[$empIdStr])) continue; // Skip if not active

        $extendMin = $extendMins[$empIdStr] ?? 0;
        $allowedEndTs = $lunchEndTs + ($extendMin * 60);

        if (time() > $allowedEndTs + 5 * 60) {
            $breakStartTs = strtotime($ab['break_start_time']);
            if ($breakStartTs < $allowedEndTs) {
                // Do not update employee status or deactivate employee automatically.
            }
        }
    }

    // 3. Employee Counts
    $empCounts = [
        'total' => countDocs(collection('employees')),
        'active' => countDocs(collection('employees'), $activeStatusFilter),
        'inactive' => countDocs(collection('employees'), $inactiveStatusFilter)
    ];

    // 4. Pending Leaves
    $pendingLeaves = countDocs(collection('leaves'), ['status' => 'pending']);

    // 5. Today's Attendance Counts
    $todayAtts = findMany(collection('attendance'), ['date' => $today]);
    $att = ['present' => 0, 'late' => 0, 'early' => 0];
    foreach ($todayAtts as $a) {
        if ($a['status'] === 'present') $att['present']++;
        if ($a['status'] === 'late') $att['late']++;
        if ($a['status'] === 'early_checkout') $att['early']++;
    }

    // 6. Recent Hires
    $recent = findMany(collection('employees'), [], ['sort' => ['created_at' => -1], 'limit' => 5]);
    foreach ($recent as &$r) {
        $r['id'] = (string)$r['_id'];
        unset($r['_id'], $r['password']);
        $r['joining_date'] = dashFmtDate($r['joining_date'] ?? '');
    }
    unset($r);

    // 7. Upcoming Birthdays
    $allEmps = findMany(collection('employees'), [], ['projection' => ['name' => 1, 'date_of_birth' => 1, 'employee_code' => 1]]);
    $birthdays = [];
    $currentYear = (int)date('Y');
    foreach ($allEmps as $emp) {
        if (empty($emp['date_of_birth'])) continue;
        $dobStr = dashFmtDate($emp['date_of_birth']);
        $dobParts = explode('-', $dobStr);
        if (count($dobParts) !== 3) continue;

        $bdayThisYear = "$currentYear-{$dobParts[1]}-{$dobParts[2]}";
        if (strtotime($bdayThisYear) < strtotime('today')) {
            $bdayThisYear = ($currentYear + 1) . "-{$dobParts[1]}-{$dobParts[2]}";
        }

        $daysUntil = (strtotime($bdayThisYear) - strtotime('today')) / 86400;
        if ($daysUntil >= 0 && $daysUntil <= 30) {
            $emp['date_of_birth'] = $dobStr;
            $emp['id'] = (string)$emp['_id'];
            unset($emp['_id'], $emp['password']);
            $emp['bday_md'] = "{$dobParts[1]}-{$dobParts[2]}";
            $birthdays[] = $emp;
        }
    }
    usort($birthdays, fn($a, $b) => strcmp($a['bday_md'], $b['bday_md']));
    $birthdays = array_slice($birthdays, 0, 5);

    // 8. Monthly Stats
    $sixMonthsAgo = date('Y-m-d', strtotime('-6 months'));
    $recentAtts = findMany(collection('attendance'), ['date' => ['$gte' => $sixMonthsAgo]]);
    $monthlyMap = [];
    foreach ($recentAtts as $a) {
        $month = substr($a['date'], 0, 7);
        if (!isset($monthlyMap[$month])) {
            $monthlyMap[$month] = ['month' => $month, 'total' => 0, 'present' => 0, 'late' => 0];
        }
        $monthlyMap[$month]['total']++;
        if ($a['status'] === 'present') $monthlyMap[$month]['present']++;
        if ($a['status'] === 'late') $monthlyMap[$month]['late']++;
    }
    $monthlyStats = array_values($monthlyMap);
    usort($monthlyStats, fn($a, $b) => strcmp($a['month'], $b['month']));
    $attendanceChart = dashBuildAttendanceChart($_GET['range'] ?? 'month');

    // 9. HR Notifications — support optional date filter
    // Notification summary/list are loaded by notifications.php only.

    // 10. Pending Break Requests
    $breakReqs = findMany(collection('break_requests'), ['status' => 'pending'], [
        'sort' => ['created_at' => 1],
        'limit' => 100,
    ]);
    $allEmpNames = [];
    foreach ($allEmps as $emp) {
        $allEmpNames[(string)$emp['_id']] = $emp;
        if (!empty($emp['id'])) $allEmpNames[(string)$emp['id']] = $emp;
    }
    foreach ($breakReqs as &$req) {
        $req['id'] = (string)$req['_id'];
        unset($req['_id']); // prevent ObjectId serialisation issues in JSON
        $emp = $allEmpNames[(string)$req['employee_id']] ?? null;
        $req['employee_name'] = $emp['name'] ?? 'Unknown';
        $req['employee_code'] = $emp['employee_code'] ?? '';
    }
    unset($req);

    // 11. Active Break Sessions
    $activeSessions = findMany(collection('break_sessions'), [
        'status' => ['$in' => ['active', 'extended']]
    ], ['limit' => 100]);
    foreach ($activeSessions as &$sess) {
        $sess['id'] = (string)$sess['_id'];
        unset($sess['_id']);
        $empIdStr = (string)$sess['employee_id'];
        $empDoc = $allEmpNames[$empIdStr] ?? null;
        $sess['employee_name'] = $empDoc['name'] ?? 'Unknown';
        $sess['employee_code'] = $empDoc['employee_code'] ?? '';
    }
    unset($sess);

    ok(sanitizeForJson([
        'total_employees'   => $empCounts['total'],
        'active_employees'  => $empCounts['active'],
        'inactive_employees'=> $empCounts['inactive'],
        'pending_leaves'    => $pendingLeaves,
        'present_today'     => $att['present'],
        'late_today'        => $att['late'],
        'early_today'       => $att['early'],
        'recent_hires'      => $recent,
        'upcoming_birthdays'=> $birthdays,
        'monthly_stats'     => $monthlyStats,
        'attendance_chart'  => $attendanceChart,
        'pending_break_requests' => $breakReqs,
        'active_break_sessions' => $activeSessions,
        'attendance_settings' => dashboardAttendanceSettings(),
    ]));
}

// ════════════════════════════════════════════════════════════
// EMPLOYEE DASHBOARD
// ════════════════════════════════════════════════════════════

dashSyncAutoBreaksForEmployee($user['id']);

$todayAttendance = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
if ($todayAttendance) {
    $todayAttendance = dashEnrichWorkedDuration($todayAttendance);
}

$recentAttendance = findMany(collection('attendance'), ['employee_id' => $user['id']], ['sort' => ['date' => -1], 'limit' => 10]);
foreach ($recentAttendance as &$attRow) {
    $attRow['id'] = (string)$attRow['_id'];
    $attRow = dashEnrichWorkedDuration($attRow);
}
unset($attRow);

$pendingLeaves = countDocs(collection('leaves'), ['employee_id' => $user['id'], 'status' => 'pending']);

$upcomingHolidays = findMany(collection('holidays'), ['date' => ['$gte' => $today]], ['sort' => ['date' => 1], 'limit' => 5]);
foreach ($upcomingHolidays as &$h) {
    $h['id'] = (string)$h['_id'];
}
unset($h);

$pendingBreakRequest = findOne(collection('break_requests'), ['employee_id' => $user['id'], 'date' => $today, 'status' => 'pending']);
$approvedBreakRequests = findMany(collection('break_requests'), ['employee_id' => $user['id'], 'date' => $today, 'status' => 'approved'], ['sort' => ['created_at' => -1], 'limit' => 1]);
$approvedBreakRequest = $approvedBreakRequests[0] ?? null;
$todayBreakRequests = findMany(collection('break_requests'), ['employee_id' => $user['id'], 'date' => $today], ['sort' => ['created_at' => -1], 'limit' => 8]);
foreach ($todayBreakRequests as &$req) {
    $req['id'] = (string)$req['_id'];
    unset($req['_id']);
}
unset($req);

$activeBreakSession = findOne(collection('break_sessions'), [
    'employee_id' => $user['id'],
    'status' => ['$in' => ['active', 'extended']]
]);
if ($activeBreakSession) {
    $activeBreakSession['id'] = (string)$activeBreakSession['_id'];
    unset($activeBreakSession['_id']);
}

$todayBreakSessions = [];
if ($todayAttendance) {
    $sessions = findMany(collection('break_sessions'), [
        'employee_id' => $user['id'],
        'attendance_id' => (string)$todayAttendance['_id']
    ]);
    foreach ($sessions as $s) {
        $s['id'] = (string)$s['_id'];
        unset($s['_id']);
        $todayBreakSessions[] = $s;
    }
}

ok(sanitizeForJson([
    'today_attendance'  => $todayAttendance,
    'recent_attendance' => $recentAttendance,
    'pending_leaves'    => $pendingLeaves,
    'upcoming_holidays' => $upcomingHolidays,
    'attendance_settings' => dashboardAttendanceSettings(),
    'pending_break_request' => $pendingBreakRequest,
    'approved_break_request' => $approvedBreakRequest,
    'today_break_requests' => $todayBreakRequests,
    'active_break_session' => $activeBreakSession,
    'today_break_sessions' => $todayBreakSessions,
]));
