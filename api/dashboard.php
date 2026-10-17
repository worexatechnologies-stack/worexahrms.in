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
    $defaults = [
        'checkin_open'         => '09:00',
        'checkin_close'        => '10:45',
        'checkout_open'        => '18:30',
        'checkout_close'       => '19:00',
        'lunch_start'          => '13:30',
        'lunch_end'            => '14:30',
        'lunch_duration_min'   => 60,
        'evening_start'        => '16:30',
        'evening_end'          => '17:00',
        'evening_duration_min' => 30,
        'absence_mark_after'   => '13:00',
        'late_after'           => '09:45',
    ];
    $saved = findOne(collection('settings'), ['key' => 'attendance_settings']);
    // MongoDB stores nested objects as BSONDocument, NOT a PHP array. is_array()
    // is false for BSONDocument, which silently dropped the saved value and
    // fell back to defaults. Cast to array first so merges work.
    $savedValue = $saved['value'] ?? null;
    if ($savedValue instanceof MongoDB\Model\BSONDocument) $savedValue = $savedValue->getArrayCopy();
    $value = is_array($savedValue) ? $savedValue : [];

    // Backwards compatibility: older installs stored each setting as its own
    // document ({key: 'checkin_open', value: '09:00'}). Reconstruct those so
    // existing saved values are honoured even before the single-doc is written.
    $legacyKeys = array_keys($defaults);
    $legacyRows = findMany(collection('settings'), ['key' => ['$in' => $legacyKeys]]);
    foreach ($legacyRows as $row) {
        $k = (string)($row['key'] ?? '');
        if ($k !== '' && !isset($value[$k])) {
            $value[$k] = $row['value'] ?? '';
        }
    }

    $settings = array_merge($defaults, $value);
    // Explicitly persisted times must be honoured. Earlier versions hardcoded
    // these values after the merge, which silently discarded HR's saved changes.
    $settings['office_locations'] = $value['office_locations'] ?? [];
    $settings['devices']          = $value['devices'] ?? [];
    return $settings;
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

function dashLiveStartTimestamp(array $rec, int $nowTs): int
{
    $sessionTs = strtotime($rec['last_resumed_at'] ?? $rec['clock_in_at'] ?? '');
    $checkInTs = !empty($rec['date']) && !empty($rec['check_in'])
        ? strtotime($rec['date'] . ' ' . $rec['check_in'])
        : false;
    $accumulated = (int)($rec['accumulated_work_seconds'] ?? 0)
        + (int)($rec['accumulated_meeting_seconds'] ?? 0)
        + (int)($rec['accumulated_lunch_seconds'] ?? 0)
        + (int)($rec['accumulated_break_seconds'] ?? 0)
        + (int)($rec['accumulated_extended_break_seconds'] ?? 0);

    if ($accumulated === 0 && $checkInTs && (!$sessionTs || $sessionTs > $checkInTs)) {
        return $checkInTs;
    }
    return $sessionTs ?: $nowTs;
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

    // Manual-snapshot records are created/edited on the HR Attendance form:
    // they carry a `breaks` array (lunch/break start & end). That array is ONLY
    // written by the HR manual form — auto breaks live in break_sessions — so it
    // is authoritative whenever present. Net = (end − start) − Σ breaks, and it
    // overrides any live accumulated buckets that ignored these break windows.
    //
    // NOTE: MongoDB returns nested arrays as BSONDocument, not PHP arrays — so we
    // must normalise to a plain array before the is_array() check.
    $breaksRaw = $rec['breaks'] ?? null;
    if ($breaksRaw instanceof MongoDB\Model\BSONDocument) $breaksRaw = $breaksRaw->getArrayCopy();
    $breaksNorm = is_array($breaksRaw) ? array_values($breaksRaw) : [];
    $isManualSnapshot = !empty($breaksNorm);

    if ($isManualSnapshot) {
        $manualBreakSecs = 0;
        foreach ($breaksNorm as $b) {
            if ($b instanceof MongoDB\Model\BSONDocument) $b = $b->getArrayCopy();
            if (!is_array($b)) continue;
            $s = strtotime((string)($b['started_at'] ?? ''));
            $e = strtotime((string)($b['ended_at'] ?? ''));
            if ($s && $e) {
                $d = $e - $s;
                if ($d < 0) $d += 86400; // break crosses midnight
                if ($d > 0) $manualBreakSecs += $d;
            }
        }

        $date = (string)($rec['date'] ?? date('Y-m-d'));
        $checkInTs = strtotime($date . ' ' . (string)($rec['check_in'] ?? ''));
        if ($checkInTs) {
            $endTs = !empty($rec['check_out'])
                ? (strtotime($date . ' ' . (string)$rec['check_out']) ?: $now)
                : $now;
            $productiveSecs = max(0, ($endTs - $checkInTs) - $manualBreakSecs);
            $requiredSecs = (int)($rec['required_work_seconds'] ?? 28800);
            $rec['worked_seconds'] = $productiveSecs;
            $rec['total_break_seconds'] = $manualBreakSecs;
            $rec['breaks'] = $breaksNorm;
            $rec['live_productive_working_seconds'] = $productiveSecs;
            $rec['net_working_hours'] = dashFormatWorkedDuration($productiveSecs);
            $rec['working_hours'] = $rec['net_working_hours'];
            $rec['overtime_seconds'] = max(0, $productiveSecs - $requiredSecs);
            $rec['overtime_hours'] = dashFormatWorkedDuration($rec['overtime_seconds']);
            return $rec;
        }
    }

    $lastResumed = dashLiveStartTimestamp($rec, $now);
    $delta = max(0, $now - $lastResumed);

    $workSecs = (int)($rec['accumulated_work_seconds'] ?? 0);
    $meetingSecs = (int)($rec['accumulated_meeting_seconds'] ?? 0);
    $lunchSecs = (int)($rec['accumulated_lunch_seconds'] ?? 0);
    $breakSecs = (int)($rec['accumulated_break_seconds'] ?? 0);
    $extendedSecs = (int)($rec['accumulated_extended_break_seconds'] ?? 0);

    $wfhSecs = (int)($rec['wfh_working_seconds'] ?? 0);
    $officeSecs = (int)($rec['office_working_seconds'] ?? 0);

    $activeType = $rec['active_activity_type'] ?? 'working';
    if (get_active_db_name() === 'hrms_viyana') {
        $activeType = 'working';
    }
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

        $checkInTs = !empty($rec['date']) && !empty($rec['check_in'])
            ? strtotime($rec['date'] . ' ' . $rec['check_in'])
            : false;
        $trackedSecs = $workSecs + $meetingSecs + $lunchSecs + $breakSecs;
        $missingWorkSecs = $checkInTs ? max(0, ($now - $checkInTs) - $trackedSecs) : 0;
        if ($missingWorkSecs > 60) {
            $workSecs += $missingWorkSecs;
            if (($rec['work_mode'] ?? 'office') === 'wfh') {
                $wfhSecs += $missingWorkSecs;
            } else {
                $officeSecs += $missingWorkSecs;
            }
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

    // Creating the scheduled break session alone is not enough: the summary
    // derives its lunch/break values from the attendance activity state.
    $rec = dashTransitionActivity($rec, $breakType === 'lunch' ? 'lunch' : 'break', $startTs);
    $rec['break_start_time'] = date('H:i:s', $startTs);
    $rec = dashEnrichWorkedDuration($rec);
    updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);
    $session['_id'] = $saved['_id'];
    return $session;
}

function dashTransitionActivity(array $rec, string $newType, int $nowTs): array
{
    $lastResumedTs = dashLiveStartTimestamp($rec, $nowTs);
    $delta = max(0, $nowTs - $lastResumedTs);
    $activeType = $rec['active_activity_type'] ?? 'working';

    if ($activeType === 'working') {
        $rec['accumulated_work_seconds'] = (int)($rec['accumulated_work_seconds'] ?? 0) + $delta;
        if (($rec['work_mode'] ?? 'office') === 'wfh') {
            $rec['wfh_working_seconds'] = (int)($rec['wfh_working_seconds'] ?? 0) + $delta;
        } else {
            $rec['office_working_seconds'] = (int)($rec['office_working_seconds'] ?? 0) + $delta;
        }
    } elseif ($activeType === 'meeting') {
        $rec['accumulated_meeting_seconds'] = (int)($rec['accumulated_meeting_seconds'] ?? 0) + $delta;
    } elseif ($activeType === 'lunch') {
        $rec['accumulated_lunch_seconds'] = (int)($rec['accumulated_lunch_seconds'] ?? 0) + $delta;
    } elseif ($activeType === 'break') {
        $rec['accumulated_break_seconds'] = (int)($rec['accumulated_break_seconds'] ?? 0) + $delta;
    }

    $rec['active_activity_type'] = $newType;
    $rec['last_resumed_at'] = date('Y-m-d H:i:s', $nowTs);
    return $rec;
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
    if (get_active_db_name() === 'hrms_viyana') {
        return;
    }
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
    if ($active) {
        // Same reconciliation as attendance.php: keep the productive timer
        // frozen while a break session is open, even if a legacy sync left the
        // attendance record in 'working'. Productive time must not run during
        // a break, and the break must not be auto-closed.
        $activeType = (string)($rec['active_activity_type'] ?? 'working');
        $breakState = ((string)($active['break_type'] ?? 'manual') === 'lunch') ? 'lunch' : 'break';
        if ($activeType !== 'meeting' && $activeType !== $breakState) {
            $startedTs = strtotime((string)($active['started_at'] ?? ''));
            if (!$startedTs || $startedTs > time()) $startedTs = time();
            $rec = dashTransitionActivity($rec, $breakState, $startedTs);
            $rec['break_start_time'] = date('H:i:s', $startedTs);
            $rec = dashEnrichWorkedDuration($rec);
            updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);
        }
        return;
    }

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
    $absentAttendance = [];
    foreach ($todayAtts as $a) {
        if ($a['status'] === 'present') $att['present']++;
        if ($a['status'] === 'late') $att['late']++;
        if ($a['status'] === 'early_checkout') $att['early']++;
        if (($a['status'] ?? '') === 'absent') $absentAttendance[] = $a;
    }

    // Include the people behind today's absent count so HR can see them directly.
    $absentEmployeeIds = array_values(array_unique(array_map(
        fn($a) => (string)($a['employee_id'] ?? ''),
        $absentAttendance
    )));
    $absentEmployeeMap = [];
    $validAbsentIds = array_values(array_filter($absentEmployeeIds, fn($id) => preg_match('/^[a-f\d]{24}$/i', $id)));
    if ($validAbsentIds) {
        $absentEmployees = findMany(collection('employees'), [
            '_id' => ['$in' => array_map(fn($id) => mongoId($id), $validAbsentIds)]
        ], ['projection' => ['name' => 1, 'employee_code' => 1, 'department' => 1]]);
        foreach ($absentEmployees as $emp) $absentEmployeeMap[(string)$emp['_id']] = $emp;
    }
    $absentToday = [];
    foreach ($absentAttendance as $record) {
        $employee = $absentEmployeeMap[(string)($record['employee_id'] ?? '')] ?? [];
        $absentToday[] = [
            'employee_id' => (string)($record['employee_id'] ?? ''),
            'name' => $employee['name'] ?? 'Unknown employee',
            'employee_code' => $employee['employee_code'] ?? '',
            'department' => $employee['department'] ?? '',
        ];
    }
    usort($absentToday, fn($a, $b) => strcasecmp($a['name'], $b['name']));

    // 6. Recent Hires
    $recent = findMany(collection('employees'), [], ['sort' => ['created_at' => -1], 'limit' => 5]);
    foreach ($recent as &$r) {
        $r['id'] = (string)$r['_id'];
        unset($r['_id'], $r['password']);
        $r['joining_date'] = dashFmtDate($r['joining_date'] ?? '');
    }
    unset($r);

    // 7. Upcoming Birthdays
    $allEmps = findMany(collection('employees'), [], ['projection' => ['name' => 1, 'date_of_birth' => 1, 'employee_code' => 1, 'department' => 1, 'profile_image' => 1]]);
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
        'sort' => ['created_at' => -1],
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
        $req['department']    = $emp['department'] ?? '';
        $req['profile_image'] = $emp['profile_image'] ?? null;
        $req['created_at']    = sanitizeForJson($req['created_at'] ?? null);
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

    // 12. On Leave Today — active employees with an APPROVED leave covering today.
    //     Leave is still pending until HR approves, so a pending request never
    //     makes the employee appear as on-leave.
    $empFull = [];
    foreach ($activeEmployees as $emp) {
        $empFull[(string)$emp['_id']] = $emp;
    }
    $approvedLeavesToday = findMany(collection('leaves'), [
        'status'      => 'approved',
        'start_date'  => ['$lte' => $today],
        'end_date'    => ['$gte' => $today],
    ]);
    $onLeaveInfo = [];
    foreach ($approvedLeavesToday as $lv) {
        $eid = (string)($lv['employee_id'] ?? '');
        if ($eid === '' || !isset($empFull[$eid])) continue;
        if (!isset($onLeaveInfo[$eid])) {
            $onLeaveInfo[$eid] = [
                'leave_type' => (string)($lv['leave_type'] ?? ''),
                'start_date' => (string)($lv['start_date'] ?? ''),
                'end_date'   => (string)($lv['end_date'] ?? ''),
            ];
        }
    }
    $onLeaveEmployees = [];
    foreach ($onLeaveInfo as $eid => $info) {
        $emp = $empFull[$eid] ?? [];
        $onLeaveEmployees[] = [
            'employee_id'   => $eid,
            'name'          => $emp['name'] ?? 'Unknown',
            'employee_code' => $emp['employee_code'] ?? '',
            'department'    => $emp['department'] ?? '',
            'profile_image' => $emp['profile_image'] ?? null,
            'leave_type'    => $info['leave_type'],
            'start_date'    => $info['start_date'],
            'end_date'      => $info['end_date'],
        ];
    }
    usort($onLeaveEmployees, fn($a, $b) => strcasecmp($a['name'], $b['name']));
    $onLeaveToday = count($onLeaveEmployees);
    $onLeaveIdMap = array_fill_keys(array_column($onLeaveEmployees, 'employee_id'), true);

    // Present today list with full employee details
    $presentEmployees = [];
    foreach ($todayAtts as $a) {
        $eid = (string)($a['employee_id'] ?? '');
        if (isset($empFull[$eid]) && !isset($onLeaveIdMap[$eid]) && in_array($a['status'] ?? '', ['present', 'late', 'early_checkout'], true)) {
            $emp = $empFull[$eid];
            $presentEmployees[] = [
                'id'            => $eid,
                'name'          => $emp['name'] ?? 'Unknown',
                'employee_code' => $emp['employee_code'] ?? '',
                'department'    => $emp['department'] ?? '',
                'designation'   => $emp['designation'] ?? '',
                'profile_image' => $emp['profile_image'] ?? null,
                'check_in'      => $a['check_in'] ?? '',
                'check_out'     => $a['check_out'] ?? '',
                'status'        => $a['status'] ?? 'present',
                'work_mode'     => $a['work_mode'] ?? 'office',
            ];
        }
    }
    usort($presentEmployees, fn($a, $b) => strcasecmp($a['name'], $b['name']));
    $presentToday = count($presentEmployees);

    // Total employees list with full details
    $allEmployeesList = [];
    foreach ($activeEmployees as $emp) {
        $allEmployeesList[] = [
            'id'            => (string)$emp['_id'],
            'name'          => $emp['name'] ?? 'Unknown',
            'employee_code' => $emp['employee_code'] ?? '',
            'department'    => $emp['department'] ?? '',
            'designation'   => $emp['designation'] ?? '',
            'profile_image' => $emp['profile_image'] ?? null,
            'status'        => $emp['status'] ?? 'active',
        ];
    }
    usort($allEmployeesList, fn($a, $b) => strcasecmp($a['name'], $b['name']));

    // Absent today — attendance 'absent' records, but never employees on approved leave.
    $absentToday = array_values(array_filter($absentToday, function ($rec) use ($onLeaveIdMap) {
        return !isset($onLeaveIdMap[(string)$rec['employee_id']]);
    }));

    // 13. Pending Leave Requests — HR approve/reject feed (source of truth = DB)
    $pendingLeavesList = findMany(collection('leaves'), ['status' => 'pending'], [
        'sort'  => ['created_at' => -1],
        'limit' => 50,
    ]);
    $pendingLeaveRequests = [];
    foreach ($pendingLeavesList as $lv) {
        $eid = (string)($lv['employee_id'] ?? '');
        $emp = $empFull[$eid] ?? null;
        $pendingLeaveRequests[] = [
            'id'            => (string)$lv['_id'],
            'employee_id'   => $eid,
            'employee_name' => $emp['name'] ?? 'Unknown',
            'employee_code' => $emp['employee_code'] ?? '',
            'department'    => $emp['department'] ?? '',
            'profile_image' => $emp['profile_image'] ?? null,
            'leave_type'    => (string)($lv['leave_type'] ?? ''),
            'start_date'    => (string)($lv['start_date'] ?? ''),
            'end_date'      => (string)($lv['end_date'] ?? ''),
            'reason'        => (string)($lv['reason'] ?? ''),
            'status'        => 'pending',
            'created_at'    => sanitizeForJson($lv['created_at'] ?? null),
        ];
    }

    // 14. WFH Today & Pending WFH Requests — active employees with an APPROVED
    //     WFH covering today count as working from home; pending WFH still needs
    //     HR approval so it never counts a person as currently on WFH.
    $approvedWfhToday = findMany(collection('wfh'), [
        'status'     => 'approved',
        'start_date' => ['$lte' => $today],
        'end_date'   => ['$gte' => $today],
    ]);
    $wfhEmployees = [];
    foreach ($approvedWfhToday as $w) {
        $eid = (string)($w['employee_id'] ?? '');
        if ($eid !== '' && isset($empFull[$eid])) {
            $emp = $empFull[$eid];
            $wfhEmployees[] = [
                'id'            => $eid,
                'name'          => $emp['name'] ?? 'Unknown',
                'employee_code' => $emp['employee_code'] ?? '',
                'department'    => $emp['department'] ?? '',
                'designation'   => $emp['designation'] ?? '',
                'profile_image' => $emp['profile_image'] ?? null,
                'start_date'    => (string)($w['start_date'] ?? ''),
                'end_date'      => (string)($w['end_date'] ?? ''),
                'reason'        => (string)($w['reason'] ?? ''),
                'status'        => 'wfh',
            ];
        }
    }
    usort($wfhEmployees, fn($a, $b) => strcasecmp($a['name'], $b['name']));
    $wfhToday = count($wfhEmployees);

    $pendingWfhList = findMany(collection('wfh'), ['status' => 'pending'], [
        'sort'  => ['created_at' => -1],
        'limit' => 50,
    ]);
    $pendingWfhRequests = [];
    foreach ($pendingWfhList as $w) {
        $eid = (string)($w['employee_id'] ?? '');
        $emp = $empFull[$eid] ?? null;
        $pendingWfhRequests[] = [
            'id'            => (string)$w['_id'],
            'employee_id'   => $eid,
            'employee_name' => $emp['name'] ?? 'Unknown',
            'employee_code' => $emp['employee_code'] ?? '',
            'department'    => $emp['department'] ?? '',
            'profile_image' => $emp['profile_image'] ?? null,
            'start_date'    => (string)($w['start_date'] ?? ''),
            'end_date'      => (string)($w['end_date'] ?? ''),
            'reason'        => (string)($w['reason'] ?? ''),
            'status'        => 'pending',
            'created_at'    => sanitizeForJson($w['created_at'] ?? null),
        ];
    }

    // 15. Pending Late Check-In Approvals — unread HR notifications requesting a
    //     late check-in approval. Decision state lives in the notification message
    //     (;decision=...), so an already-decided request is never listed twice.
    $lateApprovals = [];
    $lateDocs = findMany(collection('notifications'), [
        'role'       => 'hr',
        'user_id'    => $user['id'],
        'event_type' => 'attendance_approval.created',
        'is_cleared' => ['$ne' => true],
    ], ['sort' => ['created_at' => -1], 'limit' => 50]);
    foreach ($lateDocs as $nf) {
        $msg = (string)($nf['message'] ?? '');
        if (str_contains($msg, ';decision=')) continue; // already decided
        $eid = (string)($nf['source_employee_id'] ?? '');
        $emp = $empFull[$eid] ?? null;
        $lateApprovals[] = [
            'id'            => (string)$nf['_id'],
            'employee_id'   => $eid,
            'employee_name' => $emp['name'] ?? ($nf['source_employee_name'] ?? 'Unknown'),
            'employee_code' => $emp['employee_code'] ?? '',
            'department'    => $emp['department'] ?? '',
            'profile_image' => $emp['profile_image'] ?? null,
            'message'       => $msg,
            'check_in_date' => $nf['check_in_date'] ?? '',
            'check_in_time' => $nf['check_in_time'] ?? '',
            'created_at'    => sanitizeForJson($nf['created_at'] ?? null),
        ];
    }

    // 16. Overdue Pending Approvals (pending requests from yesterday or earlier past 12:00 AM midnight)
    $overdueItems = [];
    $todayStart = date('Y-m-d 00:00:00');
    foreach ($breakReqs as $br) {
        $brDate = $br['date'] ?? (!empty($br['created_at']) ? substr((string)$br['created_at'], 0, 10) : '');
        $brCreated = !empty($br['created_at']) ? (string)$br['created_at'] : '';
        if (($brDate && $brDate < $today) || ($brCreated && $brCreated < $todayStart)) {
            $overdueItems[] = [
                'id'            => $br['id'],
                'category'      => 'break',
                'type'          => 'Break Approval',
                'subtype'       => $br['break_type'] ?? ($br['request_type'] ?? 'Break'),
                'employee_name' => $br['employee_name'] ?? 'Unknown',
                'employee_code' => $br['employee_code'] ?? '',
                'department'    => $br['department'] ?? '',
                'profile_image' => $br['profile_image'] ?? null,
                'date'          => $brDate ?: substr($brCreated, 0, 10),
                'time'          => $br['request_time'] ?? '',
                'created_at'    => $brCreated,
                'reason'        => $br['reason'] ?? '',
            ];
        }
    }
    foreach ($pendingLeaveRequests as $lr) {
        $lrCreated = !empty($lr['created_at']) ? (string)$lr['created_at'] : '';
        $lrDate = !empty($lrCreated) ? substr($lrCreated, 0, 10) : ($lr['start_date'] ?? '');
        if (($lrDate && $lrDate < $today) || ($lrCreated && $lrCreated < $todayStart)) {
            $overdueItems[] = [
                'id'            => $lr['id'],
                'category'      => 'leave',
                'type'          => 'Leave Request',
                'subtype'       => $lr['leave_type'] ?? 'Leave',
                'employee_name' => $lr['employee_name'] ?? 'Unknown',
                'employee_code' => $lr['employee_code'] ?? '',
                'department'    => $lr['department'] ?? '',
                'profile_image' => $lr['profile_image'] ?? null,
                'date'          => $lrDate,
                'created_at'    => $lrCreated,
                'reason'        => $lr['reason'] ?? '',
            ];
        }
    }
    foreach ($pendingWfhRequests as $wr) {
        $wrCreated = !empty($wr['created_at']) ? (string)$wr['created_at'] : '';
        $wrDate = !empty($wr['date']) ? $wr['date'] : (!empty($wr['start_date']) ? $wr['start_date'] : substr($wrCreated, 0, 10));
        if (($wrDate && $wrDate < $today) || ($wrCreated && $wrCreated < $todayStart)) {
            $overdueItems[] = [
                'id'            => $wr['id'],
                'category'      => 'wfh',
                'type'          => 'WFH Request',
                'subtype'       => 'Work From Home',
                'employee_name' => $wr['employee_name'] ?? 'Unknown',
                'employee_code' => $wr['employee_code'] ?? '',
                'department'    => $wr['department'] ?? '',
                'profile_image' => $wr['profile_image'] ?? null,
                'date'          => $wrDate,
                'created_at'    => $wrCreated,
                'reason'        => $wr['reason'] ?? '',
            ];
        }
    }
    foreach ($lateApprovals as $la) {
        $laCreated = !empty($la['created_at']) ? (string)$la['created_at'] : '';
        $laDate = $la['check_in_date'] ?? substr($laCreated, 0, 10);
        if (($laDate && $laDate < $today) || ($laCreated && $laCreated < $todayStart)) {
            $overdueItems[] = [
                'id'            => $la['id'],
                'category'      => 'late_approval',
                'type'          => 'Late Check-In Approval',
                'subtype'       => 'Late Attendance',
                'employee_name' => $la['employee_name'] ?? 'Unknown',
                'employee_code' => $la['employee_code'] ?? '',
                'department'    => $la['department'] ?? '',
                'profile_image' => $la['profile_image'] ?? null,
                'date'          => $laDate,
                'time'          => $la['check_in_time'] ?? '',
                'created_at'    => $laCreated,
                'reason'        => $la['message'] ?? '',
            ];
        }
    }

    ok(sanitizeForJson([
        'total_employees'           => $empCounts['total'],
        'total_employees_list'      => $allEmployeesList,
        'active_employees'          => $empCounts['active'],
        'inactive_employees'        => $empCounts['inactive'],
        'pending_leaves'            => $pendingLeaves,
        'present_today'             => $presentToday,
        'present_employees'         => $presentEmployees,
        'late_today'                => $att['late'],
        'early_today'               => $att['early'],
        'absent_today'              => $absentToday,
        'on_leave_today'            => $onLeaveToday,
        'on_leave_employees'        => $onLeaveEmployees,
        'pending_leave_requests'    => $pendingLeaveRequests,
        'wfh_today'                 => $wfhToday,
        'wfh_employees'             => $wfhEmployees,
        'pending_wfh_requests'      => $pendingWfhRequests,
        'recent_hires'              => $recent,
        'upcoming_birthdays'        => $birthdays,
        'monthly_stats'             => $monthlyStats,
        'attendance_chart'          => $attendanceChart,
        'pending_break_requests'    => $breakReqs,
        'pending_late_approvals'    => $lateApprovals,
        'active_break_sessions'     => $activeSessions,
        'attendance_settings'       => dashboardAttendanceSettings(),
        'overdue_pending_approvals' => [
            'locked'        => count($overdueItems) > 0,
            'total_overdue' => count($overdueItems),
            'today'         => $today,
            'items'         => $overdueItems,
        ],
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
    ], ['sort' => ['started_at' => 1]]);
    foreach ($sessions as $s) {
        $s['id'] = (string)$s['_id'];
        unset($s['_id']);
        $todayBreakSessions[] = $s;
    }
    if (empty($todayAttendance['breaks'])) {
        $todayAttendance['breaks'] = array_map(function($s) {
            $sRaw = (string)($s['started_at'] ?? '');
            $eRaw = (string)($s['ended_at'] ?? '');
            $sTime = strpos($sRaw, ' ') !== false ? explode(' ', $sRaw)[1] : $sRaw;
            $eTime = strpos($eRaw, ' ') !== false ? explode(' ', $eRaw)[1] : $eRaw;
            return [
                'break_type' => (string)($s['break_type'] ?? 'break'),
                'started_at' => substr($sTime, 0, 5),
                'ended_at'   => $eTime ? substr($eTime, 0, 5) : '',
                'status'     => (string)($s['status'] ?? 'completed'),
            ];
        }, $todayBreakSessions);
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
