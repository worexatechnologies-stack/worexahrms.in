<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$user = current_user();
$id   = id_param();
date_default_timezone_set('Asia/Kolkata');
closeAllOpenSessions();

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
══════════════════════════════════════════════════════════════════════ */
function attendanceSettings(): array
{
    $defaults = [
        'checkin_open'         => '09:00',
        'late_after'           => '09:45',
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
    ];
    $saved = findOne(collection('settings'), ['key' => 'attendance_settings']);
    $value = is_array($saved['value'] ?? null) ? $saved['value'] : [];
    $settings = array_merge($defaults, $value);
    // Explicitly persisted times must be honoured. Earlier versions hardcoded
    // these values after the merge, which silently discarded HR's saved changes.
    $settings['office_locations'] = $value['office_locations'] ?? [];
    $settings['devices']          = $value['devices'] ?? [];
    return $settings;
}

function allowedStatuses(): array
{
    return ['present', 'absent', 'late', 'early_checkout', 'half_day'];
}

function deviceSummary(array $d): string
{
    $src = substr((string) ($d['device'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? 'Unknown')), 0, 255);
    foreach (['Android', 'iPhone', 'iPad', 'Windows', 'Mac', 'Linux'] as $kw) {
        if (stripos($src, $kw) !== false) return $kw . ' device';
    }
    return $src ?: 'Unknown device';
}

function parseMsg(string $msg): array
{
    $out = [];
    foreach (explode(';', $msg) as $p) {
        if (str_contains($p, '=')) [$k, $v] = explode('=', $p, 2) and $out[trim($k)] = trim($v);
    }
    return $out;
}

function cleanMsg(string $msg): string
{
    return preg_replace('/;decision=[^;]*/', '', $msg) ?? $msg;
}

function notifyEmployee(string $empId, string $title, string $msg, string $type = 'info', array $options = []): void
{
    try {
        createNotification($empId, 'employee', $title, $msg, $type, $options);
    } catch (Exception) {}
}

function notifyHr(string $title, string $msg, string $type = 'info', array $options = []): void
{
    $hrs = findMany(collection('users'), ['role' => 'hr']);
    foreach ($hrs as $hr) {
        try {
            $hrOptions = $options;
            if (!empty($hrOptions['event_id'])) {
                $hrOptions['event_id'] = $hrOptions['event_id'] . ':hr:' . (string)$hr['_id'];
            }
            createNotification((string)$hr['_id'], 'hr', $title, $msg, $type, $hrOptions);
        } catch (Exception) {}
    }
}

function allowedBreakMinutes(): array
{
    return [10, 20, 30, 45, 50, 60];
}

function normaliseBreakType(array $req): string
{
    $type = (string)($req['break_type'] ?? '');
    if (in_array($type, ['lunch', 'evening', 'manual', 'meeting'], true)) return $type;
    $legacy = (string)($req['request_type'] ?? '');
    if ($legacy === 'lunch_break') return 'lunch';
    if ($legacy === 'evening_break') return 'evening';
    if ($legacy === 'meeting') return 'meeting';
    return 'manual';
}

function formatWorkedDurationFromSeconds(int $seconds): string
{
    $seconds = max(0, $seconds);
    $hours = (int)floor($seconds / 3600);
    $minutes = (int)floor(($seconds % 3600) / 60);
    $secs = $seconds % 60;
    return sprintf('%02d:%02d:%02d', $hours, $minutes, $secs);
}

function attendanceLiveStartTimestamp(array $rec, int $nowTs): int
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

    // Repair legacy timezone-shifted session starts on the fly. Once any
    // activity is accumulated, last_resumed_at remains the source of truth.
    if ($accumulated === 0 && $checkInTs && (!$sessionTs || $sessionTs > $checkInTs)) {
        return $checkInTs;
    }
    return $sessionTs ?: $nowTs;
}

function computeNetWorkedSeconds(array $rec, ?int $endTs = null): int
{
    if (empty($rec['check_in'])) return 0;
    $date = (string)($rec['date'] ?? date('Y-m-d'));
    $checkInTs = strtotime($date . ' ' . $rec['check_in']);
    if (!$checkInTs) $checkInTs = strtotime((string)$rec['check_in']);
    if (!$checkInTs) return 0;

    if ($endTs === null) {
        if (!empty($rec['check_out'])) {
            $endTs = strtotime($date . ' ' . $rec['check_out']);
            if (!$endTs) $endTs = strtotime((string)$rec['check_out']);
        } else {
            $endTs = time();
        }
    }

    $breakSecs = (int)($rec['total_break_seconds'] ?? 0);
    if (!empty($rec['break_start_time']) && empty($rec['check_out'])) {
        $breakStartTs = strtotime($date . ' ' . $rec['break_start_time']);
        if ($breakStartTs && $endTs > $breakStartTs) {
            $breakSecs += $endTs - $breakStartTs;
        }
    }

    return max(0, $endTs - $checkInTs - $breakSecs);
}

function enrichWorkedDuration(array $rec): array
{
    // Session-based records must always use the same productive-time timer as
    // the employee dashboard.  The previous fallback used check-in minus
    // legacy break fields, which are not updated while a modern session is
    // active; HR could therefore see 00:00 even though the employee timer ran.
    $hasSessionTimer = array_key_exists('accumulated_work_seconds', $rec)
        || array_key_exists('accumulated_meeting_seconds', $rec)
        || array_key_exists('active_activity_type', $rec)
        || array_key_exists('clock_in_at', $rec);

    if ($hasSessionTimer) {
        $live = getLiveAttendance($rec);
        $productiveSecs = (int)($live['live_productive_working_seconds'] ?? 0);
        $rec['worked_seconds'] = $productiveSecs;
        $rec['net_working_hours'] = formatWorkedDurationFromSeconds($productiveSecs);
        $rec['working_hours'] = $rec['net_working_hours'];
        $rec['overtime_seconds'] = max(0, $productiveSecs - (int)($rec['required_work_seconds'] ?? 28800));
        $rec['overtime_hours'] = formatWorkedDurationFromSeconds($rec['overtime_seconds']);
        return $rec;
    }

    // Preserve the original calculation for manually entered legacy records.
    $netSecs = computeNetWorkedSeconds($rec);
    $rec['worked_seconds'] = $netSecs;
    $rec['net_working_hours'] = formatWorkedDurationFromSeconds($netSecs);
    if (empty($rec['working_hours'])) {
        $rec['working_hours'] = $rec['net_working_hours'];
    }
    return $rec;
}

function transitionActivity(array $rec, string $newType, int $nowTs): array
{
    if (!empty($rec['is_checked_out'])) {
        return $rec;
    }

    $lastResumed = attendanceLiveStartTimestamp($rec, $nowTs);
    $delta = max(0, $nowTs - $lastResumed);

    $activeType = $rec['active_activity_type'] ?? 'working';

    // Accumulate the time for the old activity
    if ($activeType === 'working') {
        $rec['accumulated_work_seconds'] = (int)($rec['accumulated_work_seconds'] ?? 0) + $delta;
        if (($rec['work_mode'] ?? 'office') === 'wfh') {
            $rec['wfh_working_seconds'] = (int)($rec['wfh_working_seconds'] ?? 0) + $delta;
        } else {
            $rec['office_working_seconds'] = (int)($rec['office_working_seconds'] ?? 0) + $delta;
        }
    } elseif ($activeType === 'meeting') {
        $rec['accumulated_meeting_seconds'] = (int)($rec['accumulated_meeting_seconds'] ?? 0) + $delta;
        if (($rec['work_mode'] ?? 'office') === 'wfh') {
            $rec['wfh_working_seconds'] = (int)($rec['wfh_working_seconds'] ?? 0) + $delta;
        } else {
            $rec['office_working_seconds'] = (int)($rec['office_working_seconds'] ?? 0) + $delta;
        }
    } elseif ($activeType === 'lunch') {
        $rec['accumulated_lunch_seconds'] = (int)($rec['accumulated_lunch_seconds'] ?? 0) + $delta;
    } elseif ($activeType === 'break') {
        $rec['accumulated_break_seconds'] = (int)($rec['accumulated_break_seconds'] ?? 0) + $delta;
    }

    $rec['active_activity_type'] = $newType;
    $rec['last_resumed_at'] = date('Y-m-d H:i:s', $nowTs);

    // Clear pause states since we are transitioning to a new active activity
    $rec['is_paused'] = false;
    $rec['hr_timer_paused'] = false;
    $rec['hr_pause_started_at'] = null;
    $rec['hr_pause_reason'] = null;
    $rec['hr_pause_by'] = null;
    $rec['hr_pause_by_name'] = null;
    $rec['paused_at'] = null;
    $rec['paused_by'] = null;
    $rec['pause_reason'] = null;
    if ($newType === 'working') {
        $rec['break_start_time'] = null;
    }

    return $rec;
}

function getLiveAttendance(array $rec): array
{
    if (!empty($rec['is_paused']) && ($rec['pause_reason'] ?? '') === 'Auto-Paused: System Sleep / Inactivity') {
        $rec['is_paused'] = false;
        $rec['hr_timer_paused'] = false;
        $rec['paused_at'] = null;
        $rec['pause_reason'] = null;
        $rec['break_start_time'] = null;
    }

    $now = time();
    $lastResumed = attendanceLiveStartTimestamp($rec, $now);
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

        // All active attendance time is continuous from check-in. Repair a
        // gap created by old timezone-shifted session timestamps by assigning
        // the untracked earlier portion to work, not to the current break.
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

    // Productive Working Time = Active Working Time + Meeting Time
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

    return $rec;
}

function syncLegacyFields(array $rec, int $nowTs): array
{
    $live = getLiveAttendance($rec);
    $rec['total_break_seconds'] = $live['live_lunch_seconds'] + $live['live_break_seconds'];
    $rec['working_hours'] = formatWorkedDurationFromSeconds($live['live_productive_working_seconds']);
    $rec['worked_seconds'] = $live['live_productive_working_seconds'];
    return $rec;
}

function startBreakSessionForAttendance(array $rec, string $empId, string $breakType, int $durationMinutes, ?int $startTs = null): ?array
{
    $startTs ??= time();
    $nowTs = time();
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
    if ($existing && $breakType !== 'manual') return null;

    $expectedEndAt = $startTs + ($durationMinutes * 60);
    // Automatic break windows are synced when the employee next contacts the
    // API.  If that is after the window has ended, do not leave a break open
    // from (for example) 1:30 PM until checkout.  Record the scheduled break
    // and resume the work timer at its scheduled end instead.
    $isPastScheduledBreak = $startTs < $nowTs && $expectedEndAt <= $nowTs;
    $breakEndTs = $isPastScheduledBreak ? $expectedEndAt : null;
    $session = [
        'employee_id' => $empId,
        'attendance_id' => (string)$rec['_id'],
        'break_type' => $breakType,
        'started_at' => date('Y-m-d H:i:s', $startTs),
        'expected_end_at' => date('Y-m-d H:i:s', $expectedEndAt),
        'ended_at' => $breakEndTs ? date('Y-m-d H:i:s', $breakEndTs) : null,
        'extension_minutes' => 0,
        'extension_reason' => null,
        'extended_by' => null,
        'extended_at' => null,
        'late_start_minutes' => 0,
        'late_return_minutes' => 0,
        'status' => $breakEndTs ? 'completed' : 'active',
        'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s')
    ];
    $saved = insertOne(collection('break_sessions'), $session);

    // An automatic break must also pause the attendance timer.  Previously this
    // helper only created a break_sessions document, so the employee stayed in
    // the "working" state and the whole break was counted as active work.
    $rec = transitionActivity($rec, $breakType === 'lunch' ? 'lunch' : 'break', $startTs);
    $rec['break_start_time'] = date('H:i:s', $startTs);
    if ($breakEndTs) {
        $rec = transitionActivity($rec, 'working', $breakEndTs);
    }
    $rec = syncLegacyFields($rec, $startTs);
    updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);
    
    notifyEmployee($empId, 'Break Started', 'Your break has started.', 'info', [
        'event_id' => 'break_start:' . $empId . ':' . date('Y-m-d') . ':' . $breakType . ':' . time(),
        'event_type' => 'break.started',
        'speak_text' => 'Your break has started.',
    ]);

    $session['_id'] = $saved['_id'];
    return $session;
}

function completeBreakSession(array $rec, array $session, int $endTs, bool $markLate = false): void
{
    $startedAtTs = strtotime((string)$session['started_at']);
    if (!$startedAtTs) return;

    $elapsedSecs = max(0, $endTs - $startedAtTs);
    $newTotal = (int)($rec['total_break_seconds'] ?? 0) + $elapsedSecs;

    $lateReturnMins = 0;
    if ($markLate) {
        $expectedEndTs = strtotime((string)$session['expected_end_at']);
        if ($expectedEndTs && $endTs > $expectedEndTs) {
            $lateReturnMins = (int)ceil(($endTs - $expectedEndTs) / 60);
        }
    }

    updateOne(collection('break_sessions'), ['_id' => $session['_id']], [
        'ended_at' => date('Y-m-d H:i:s', $endTs),
        'late_return_minutes' => $lateReturnMins,
        'status' => 'completed',
        'updated_at' => date('Y-m-d H:i:s')
    ]);

    updateOne(collection('attendance'), ['_id' => $rec['_id']], [
        'break_start_time' => null,
        'total_break_seconds' => $newTotal,
    ]);
}

function syncAutoBreaksForEmployee(string $empId): void
{
    $today = date('Y-m-d');
    $rec = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $today]);
    if (!$rec || empty($rec['check_in']) || !empty($rec['check_out'])) return;

    $cfg = attendanceSettings();
    $nowTs = time();
    $active = findOne(collection('break_sessions'), [
        'employee_id' => $empId,
        'attendance_id' => (string)$rec['_id'],
        'status' => ['$in' => ['active', 'extended']]
    ]);

    $autoWindows = [
        'lunch' => ['start' => $cfg['lunch_start'], 'duration' => (int)$cfg['lunch_duration_min']],
        'evening' => ['start' => $cfg['evening_start'], 'duration' => (int)$cfg['evening_duration_min']],
    ];

    if ($active) {
        $type = (string)($active['break_type'] ?? '');
        $expectedEndTs = strtotime((string)($active['expected_end_at'] ?? ''));

        // Every approved break has an expected end time. Once it has passed,
        // close it at that time. This covers automatic lunch/evening breaks
        // and HR-approved manual breaks, so a forgotten “End break” click
        // cannot remove the rest of the employee's working day.
        if (!$expectedEndTs || $expectedEndTs > $nowTs) return;

        if (in_array($rec['active_activity_type'] ?? '', ['lunch', 'break'], true)) {
            $rec = transitionActivity($rec, 'working', $expectedEndTs);
            $rec['break_start_time'] = null;
            $rec = syncLegacyFields($rec, $expectedEndTs);
            updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);
        }
        updateOne(collection('break_sessions'), ['_id' => $active['_id']], [
            'ended_at' => date('Y-m-d H:i:s', $expectedEndTs),
            'status' => 'completed',
            'updated_at' => date('Y-m-d H:i:s'),
        ]);
        $rec = findOne(collection('attendance'), ['_id' => $rec['_id']]) ?? $rec;
    }

    foreach ($autoWindows as $type => $rule) {
        $startTs = strtotime($today . ' ' . $rule['start'] . ':00');
        if (!$startTs || $nowTs < $startTs) continue;
        $existing = findOne(collection('break_sessions'), [
            'employee_id' => $empId,
            'attendance_id' => (string)$rec['_id'],
            'break_type' => $type
        ]);
        if ($existing) continue;
        $session = startBreakSessionForAttendance($rec, $empId, $type, $rule['duration'], $startTs);
        if (!$session || ($session['status'] ?? '') !== 'completed') break;

        // A late sync can have missed more than one scheduled window. Reload
        // the updated timer state before applying the next completed window.
        $rec = findOne(collection('attendance'), ['_id' => $rec['_id']]) ?? $rec;
    }
}

function autoResumeExpiredHrPause(array $rec): array
{
    // HR Pause Mode remains active indefinitely until manually resumed.
    return $rec;
}


/* ═══════════════════════════════════════════════════════════════════
   GET — today only (lightweight, used by Layout header)
══════════════════════════════════════════════════════════════════════ */
if (method() === 'GET' && !empty($_GET['today']) && $user['role'] === 'employee') {
    $today = date('Y-m-d');
    syncAutoBreaksForEmployee($user['id']);
    $att   = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if ($att) {
        $att = autoResumeExpiredHrPause($att);
        $att = getLiveAttendance($att);
        $att = syncLegacyFields($att, time());
        $att['id'] = (string) $att['_id'];
    }
    ok($att);
}

/* ═══════════════════════════════════════════════════════════════════
   GET — settings
══════════════════════════════════════════════════════════════════════ */
if (method() === 'GET' && !empty($_GET['settings'])) {
    header('Cache-Control: public, max-age=3600');
    ok(attendanceSettings());
}

/* ═══════════════════════════════════════════════════════════════════
   GET — list (HR or employee)
══════════════════════════════════════════════════════════════════════ */
if (method() === 'GET') {
    $page    = max(1, (int) ($_GET['page'] ?? 1));
    $perPage = min(200, max(10, (int) ($_GET['per_page'] ?? 50)));
    $skip    = ($page - 1) * $perPage;
    $date    = trim($_GET['date'] ?? '');
    $status  = trim($_GET['status'] ?? '');

    if ($user['role'] === 'hr') {
        $filter = [];
        if ($date !== '')   $filter['date']   = $date;
        if (isset($_GET['employee_id']) && trim((string)$_GET['employee_id']) !== '') {
            $filter['employee_id'] = trim((string)$_GET['employee_id']);
        }
        if ($status !== '') {
            if ($status === 'present') {
                $filter['status'] = ['$ne' => 'absent'];
            } else {
                $filter['status'] = $status;
            }
        }

        $total   = countDocs(collection('attendance'), $filter);
        $records = findMany(collection('attendance'), $filter, [
            'sort'  => ['date' => -1, 'check_in' => -1],
            'skip'  => $skip,
            'limit' => $perPage,
        ]);

        // Bulk-enrich with employee names (no N+1)
        $empIds  = array_unique(array_column($records, 'employee_id'));
        $empMap  = [];
        $validIds = array_values(array_filter($empIds, fn($i) => preg_match('/^[a-f\d]{24}$/i', (string)$i)));
        if ($validIds) {
            $emps = findMany(collection('employees'), ['_id' => ['$in' => array_map(fn($i) => mongoId($i), $validIds)]]);
            foreach ($emps as $e) { $empMap[(string)$e['_id']] = $e; }
        }
        foreach ($records as &$r) {
            // Keep today's HR view in sync too, so a stale automatic break is
            // repaired even when the employee is not actively refreshing.
            if (($r['date'] ?? '') === date('Y-m-d') && empty($r['check_out'])) {
                syncAutoBreaksForEmployee((string)$r['employee_id']);
                $r = findOne(collection('attendance'), ['_id' => $r['_id']]) ?? $r;
            }
            $r = autoResumeExpiredHrPause($r);
            $r = enrichWorkedDuration($r);
            $r['id'] = (string) $r['_id'];
            $emp = $empMap[$r['employee_id']] ?? null;
            $r['employee_name'] = $emp['name'] ?? 'Unknown';
            $r['employee_code'] = $emp['employee_code'] ?? '';
        }
        ok(['records' => $records, 'pagination' => ['page' => $page, 'total' => $total, 'per_page' => $perPage]]);
    }

    // Employee: own records
    syncAutoBreaksForEmployee($user['id']);
    $filter  = ['employee_id' => $user['id']];
    if ($date !== '') $filter['date'] = $date;
    $total   = countDocs(collection('attendance'), $filter);
    $records = findMany(collection('attendance'), $filter, [
        'sort'  => ['date' => -1],
        'skip'  => $skip,
        'limit' => $perPage,
    ]);
    foreach ($records as &$r) {
        $r = autoResumeExpiredHrPause($r);
        $r = enrichWorkedDuration($r);
        $r['id'] = (string) $r['_id'];
    }
    ok(['records' => $records, 'pagination' => ['page' => $page, 'total' => $total, 'per_page' => $perPage]]);
}

/* ═══════════════════════════════════════════════════════════════════
   PUT — HR update attendance record by ID
══════════════════════════════════════════════════════════════════════ */
if (method() === 'PUT' && !empty($_GET['settings']) && $user['role'] === 'hr') {
    $data = input();
    $current = attendanceSettings();
    $timeFields = ['checkin_open', 'late_after', 'checkin_close', 'checkout_open', 'checkout_close', 'lunch_start', 'lunch_end', 'evening_start', 'evening_end', 'absence_mark_after'];
    $settings = $current;

    foreach ($timeFields as $field) {
        if (!array_key_exists($field, $data)) continue;
        $value = trim((string)$data[$field]);
        if (!preg_match('/^(?:[01]\\d|2[0-3]):[0-5]\\d$/', $value)) {
            fail("Invalid {$field} time.", 422);
        }
        $settings[$field] = $value;
    }
    foreach (['lunch_duration_min' => 120, 'evening_duration_min' => 60] as $field => $max) {
        if (!array_key_exists($field, $data)) continue;
        $value = (int)$data[$field];
        if ($value < 0 || $value > $max) fail("Invalid {$field}.", 422);
        $settings[$field] = $value;
    }

    // Managed office locations ([{name, lat, lng}]) — validated and normalised.
    if (array_key_exists('office_locations', $data)) {
        $locations = is_array($data['office_locations']) ? $data['office_locations'] : [];
        $clean = [];
        foreach ($locations as $loc) {
            if (!is_array($loc)) continue;
            $name = trim((string)($loc['name'] ?? ''));
            $lat  = (float)($loc['lat'] ?? 0);
            $lng  = (float)($loc['lng'] ?? 0);
            if ($name === '' || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) continue;
            $clean[] = ['name' => $name, 'lat' => $lat, 'lng' => $lng];
        }
        $settings['office_locations'] = $clean;
    }

    // Managed devices (array of simple names/labels).
    if (array_key_exists('devices', $data)) {
        $devices = is_array($data['devices']) ? $data['devices'] : [];
        $cleanDevices = [];
        foreach ($devices as $d) {
            $label = trim((string)($d['name'] ?? $d));
            if ($label !== '') $cleanDevices[] = ['name' => $label];
        }
        $settings['devices'] = $cleanDevices;
    }

    upsertOne(collection('settings'), ['key' => 'attendance_settings'], [
        'key' => 'attendance_settings',
        'value' => $settings,
        'updated_at' => date('Y-m-d H:i:s'),
        'updated_by' => $user['id'],
    ]);
    ok($settings, 'Attendance settings saved. They apply to new break sessions immediately.');
}

if (method() === 'PUT' && $id && $user['role'] === 'hr') {
    $data   = input();
    require_fields($data, ['status']);
    $status = strtolower(trim((string) $data['status']));
    if (!in_array($status, allowedStatuses(), true)) fail('Invalid attendance status.', 422);

    $rec = findOne(collection('attendance'), ['_id' => mongoId((string) $id)]);
    if (!$rec) fail('Attendance record not found.', 404);

    $update = ['status' => $status];
    if ($status === 'absent') {
        $update += [
            'check_in' => null,
            'check_out' => null,
            'late_minutes' => 0,
            'working_hours' => null,
            'hr_timer_paused' => false,
            'hr_pause_started_at' => null,
            'hr_pause_reason' => null,
            'hr_pause_by' => null,
            'hr_pause_by_name' => null,
            'is_paused' => false,
            'break_start_time' => null,
        ];
    } else {
        foreach (['check_in', 'check_out', 'late_minutes', 'working_hours'] as $f) {
            if (array_key_exists($f, $data)) {
                $update[$f] = ($f === 'late_minutes') ? max(0, (int)$data[$f]) : ($data[$f] !== '' ? $data[$f] : null);
            }
        }
        foreach (['checkin_location', 'checkin_device'] as $f) {
            if (array_key_exists($f, $data)) {
                $update[$f] = !empty($data[$f]) ? substr(trim((string)$data[$f]), 0, 120) : null;
            }
        }
        foreach (['checkin_lat', 'checkin_lng'] as $f) {
            if (array_key_exists($f, $data) && $data[$f] !== '') {
                $update[$f] = (float)$data[$f];
            }
        }
        if (empty($rec['check_in']) && empty($update['check_in'])) {
            $update['check_in'] = '09:00:00';
        }
    }

    updateOne(collection('attendance'), ['_id' => mongoId((string) $id)], $update);

    // Sync employee status
    $empId = $rec['employee_id'];
    if (in_array($status, ['present', 'late', 'early_checkout', 'half_day'], true)) {
        updateOne(collection('employees'), ['_id' => mongoId($empId)], ['status' => 'active']);
    }

    ok(['id' => $id, 'status' => $status], 'Attendance updated.');
}

/* ═══════════════════════════════════════════════════════════════════
   PUT — employee daily task update
══════════════════════════════════════════════════════════════════════ */
if (method() === 'PUT' && !empty($_GET['task_update']) && $user['role'] === 'employee') {
    $data       = input();
    $today      = date('Y-m-d');
    $cutoffTs   = strtotime($today . ' 21:30:00');
    $taskUpdate = trim((string) ($data['daily_task_update'] ?? ''));
    if ($taskUpdate === '')            fail('Daily task update is required.', 422);
    if (strlen($taskUpdate) > 2000)    fail('Daily task update is too long.', 422);
    if (time() > $cutoffTs)            fail('Daily task update can be edited only until 9:30 PM IST.', 400);

    $rec = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if (!$rec) fail('Check in first, then add your daily task update.', 400);

    updateOne(collection('attendance'), ['_id' => $rec['_id']], [
        'daily_task_update' => $taskUpdate,
        'daily_task_updated_at' => date('Y-m-d H:i:s'),
    ]);

    // Notify HR so the submitted employee work update is visible immediately
    // in the HR notification center as well as the attendance report.
    $updateEventId = 'daily_work_update:' . $user['id'] . ':' . $today . ':' . sha1($taskUpdate);
    $existingUpdateNotice = findOne(collection('notifications'), [
        'role' => 'hr',
        'event_id' => $updateEventId,
    ]);
    if (!$existingUpdateNotice) {
        notifyHr(
            'Daily Work Update',
            "{$user['name']} submitted a daily work update for {$today}.",
            'info',
            [
                'event_id' => $updateEventId,
                'event_type' => 'daily_work_update.created',
                'source_employee_id' => $user['id'],
                'source_request_id' => (string)$rec['_id'],
                'work_date' => $today,
                'daily_task_update' => $taskUpdate,
                'speak_text' => "{$user['name']} submitted a daily work update.",
            ]
        );
    }
    ok(['date' => $today, 'daily_task_update' => $taskUpdate], 'Daily task update saved.');
}

/* ═══════════════════════════════════════════════════════════════════
   HR — POST: manually add / upsert an attendance record
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && $user['role'] === 'hr' && !isset($_GET['action'])) {
    $data = input();
    if (empty($data['employee_id']) || empty($data['date']) || empty($data['status'])) {
        fail('employee_id, date and status are required.', 422);
    }
    $empId  = (string) $data['employee_id'];
    $date   = (string) $data['date'];
    $status = strtolower(trim((string) $data['status']));
    if (!in_array($status, allowedStatuses(), true)) fail('Invalid attendance status.', 422);

    $emp = findOne(collection('employees'), ['_id' => mongoId($empId)]);
    if (!$emp) fail('Employee not found.', 404);

    $record = [
        'employee_id'          => $empId,
        'date'                 => $date,
        'status'               => $status,
        'check_in'             => ($status !== 'absent') ? (!empty($data['check_in']) ? (string) $data['check_in'] . ':00' : '09:00:00') : null,
        'check_out'            => ($status !== 'absent' && !empty($data['check_out'])) ? (string) $data['check_out'] . ':00' : null,
        'late_minutes'         => $status === 'absent' ? 0 : max(0, (int)($data['late_minutes'] ?? 0)),
        'working_hours'        => ($status !== 'absent' && !empty($data['working_hours'])) ? (string) $data['working_hours'] : null,
        'daily_task_update'    => !empty($data['daily_task_update']) ? substr(trim((string)$data['daily_task_update']), 0, 2000) : null,
        'checkin_location'     => !empty($data['checkin_location']) ? substr(trim((string)$data['checkin_location']), 0, 120) : null,
        'checkin_lat'          => isset($data['checkin_lat']) && $data['checkin_lat'] !== '' ? (float) $data['checkin_lat'] : null,
        'checkin_lng'          => isset($data['checkin_lng']) && $data['checkin_lng'] !== '' ? (float) $data['checkin_lng'] : null,
        'checkin_device'       => !empty($data['checkin_device']) ? substr(trim((string)$data['checkin_device']), 0, 100) : null,
        'checkin_user_agent'   => !empty($data['checkin_user_agent']) ? substr(trim((string)$data['checkin_user_agent']), 0, 500) : null,
        'total_break_seconds'  => 0,
        'lunch_late_minutes'   => 0,
        'evening_late_minutes' => 0,
        'created_at'           => date('Y-m-d H:i:s'),
    ];

    try {
        upsertOne(collection('attendance'), ['employee_id' => $empId, 'date' => $date], $record);

        // Sync employee status
        if (in_array($status, ['present', 'late', 'early_checkout', 'half_day'], true)) {
            updateOne(collection('employees'), ['_id' => mongoId($empId)], ['status' => 'active']);
        }
    } catch (Exception $e) {
        fail('Failed to save attendance record.', 500);
    }

    ok(['employee_id' => $empId, 'date' => $date], 'Attendance record saved.', 201);
}

/* ═══════════════════════════════════════════════════════════════════
   Guard: HR cannot check in/out (except for approval actions)
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'hr_pause_timer') {
    if ($user['role'] !== 'hr') fail('Forbidden.', 403);
    $data = input();
    require_fields($data, ['employee_id']);

    $empId = (string)$data['employee_id'];
    $reason = substr(trim((string)($data['reason'] ?? 'Paused by HR')), 0, 200);
    $today = date('Y-m-d');
    $nowStr = date('H:i:s');
    $nowDateTime = date('Y-m-d H:i:s');

    $emp = findOne(collection('employees'), ['_id' => mongoId($empId), 'status' => 'active']);
    if (!$emp) fail('Employee not found or inactive.', 404);

    $rec = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $today]);
    if (!$rec) fail('Employee has not checked in today.', 404);
    $rec = autoResumeExpiredHrPause($rec);
    if (!empty($rec['check_out'])) fail('Employee already checked out.', 400);
    if (!empty($rec['break_start_time'])) fail('Employee timer is already paused.', 400);

    updateOne(collection('employees'), ['_id' => mongoId($empId)], [
        'is_paused' => true
    ]);

    updateOne(collection('attendance'), ['_id' => $rec['_id']], [
        'break_start_time' => $nowStr,
        'hr_timer_paused' => true,
        'hr_pause_started_at' => $nowDateTime,
        'hr_pause_reason' => $reason,
        'hr_pause_by' => $user['id'],
        'hr_pause_by_name' => $user['name'] ?? 'HR',
        'is_paused' => true,
        'paused_at' => $nowDateTime,
        'paused_by' => $user['id'],
        'pause_reason' => $reason,
        'resumed_at' => null,
        'resumed_by' => null,
    ]);

    $empName = $emp['name'] ?? 'Employee';
    $pauseRecordId = (string)$rec['_id'] . '_' . str_replace(['-', ' ', ':'], '', $nowDateTime);

    // 1. Recipient notification to affected employee
    notifyEmployee($empId, 'Timer Paused by HR', 'Your timer has been paused by HR.', 'info', [
        'event_id' => "employee_pause_emp:{$empId}:{$pauseRecordId}",
        'event_type' => 'hr_pause_emp.created',
        'source_employee_id' => $empId,
        'speak_text' => 'Your timer has been paused by HR.',
    ]);

    // 2. Activity Log entry (role => hr, user_id => '')
    createNotification('', 'hr', 'HR Timer Paused', "{$empName} timer paused.", 'info', [
        'event_id' => "employee_pause:{$empId}:{$pauseRecordId}",
        'event_type' => 'hr_pause.created',
        'source_employee_id' => $empId,
        'speak_text' => "{$empName} timer paused.",
    ]);

    $updated = findOne(collection('attendance'), ['_id' => $rec['_id']]);
    if ($updated) $updated['id'] = (string)$updated['_id'];
    ok($updated, 'Employee timer paused.');
}

if (method() === 'POST' && ($_GET['action'] ?? '') === 'auto_pause_timer') {
    $empId = $user['id'];
    $reason = 'Auto-Paused: System Sleep / Inactivity';
    $today = date('Y-m-d');
    $nowStr = date('H:i:s');
    $nowDateTime = date('Y-m-d H:i:s');

    $emp = findOne(collection('employees'), ['_id' => mongoId($empId), 'status' => 'active']);
    if (!$emp) fail('Employee not found or inactive.', 404);

    $rec = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $today]);
    if (!$rec) fail('Employee has not checked in today.', 404);
    if (!empty($rec['check_out'])) fail('Employee already checked out.', 400);
    if (!empty($rec['break_start_time'])) fail('Employee timer is already paused.', 400);

    updateOne(collection('employees'), ['_id' => mongoId($empId)], [
        'is_paused' => true
    ]);

    updateOne(collection('attendance'), ['_id' => $rec['_id']], [
        'break_start_time' => $nowStr,
        'hr_timer_paused' => true,
        'hr_pause_started_at' => $nowDateTime,
        'hr_pause_reason' => $reason,
        'hr_pause_by' => 'system',
        'hr_pause_by_name' => 'System',
        'is_paused' => true,
        'paused_at' => $nowDateTime,
        'paused_by' => 'system',
        'pause_reason' => $reason,
        'resumed_at' => null,
        'resumed_by' => null,
    ]);

    $empName = $emp['name'] ?? 'Employee';
    $pauseRecordId = (string)$rec['_id'] . '_' . str_replace(['-', ' ', ':'], '', $nowDateTime);

    notifyEmployee($empId, 'Timer Auto-Paused', 'Your timer was automatically paused due to inactivity.', 'warning', [
        'event_id' => "employee_auto_pause_emp:{$empId}:{$pauseRecordId}",
        'event_type' => 'hr_pause_emp.created',
        'source_employee_id' => $empId,
        'speak_text' => 'Your timer was automatically paused due to inactivity.',
    ]);

    createNotification('', 'hr', 'Employee Timer Auto-Paused', "{$empName} timer was auto-paused (Sleep/Inactivity).", 'warning', [
        'event_id' => "employee_auto_pause:{$empId}:{$pauseRecordId}",
        'event_type' => 'hr_pause.created',
        'source_employee_id' => $empId,
        'speak_text' => "{$empName} timer was auto-paused due to inactivity.",
    ]);

    $updated = findOne(collection('attendance'), ['_id' => $rec['_id']]);
    if ($updated) $updated['id'] = (string)$updated['_id'];
    ok($updated, 'Employee timer auto-paused.');
}

if (method() === 'POST' && ($_GET['action'] ?? '') === 'hr_resume_timer') {
    if ($user['role'] !== 'hr') fail('Forbidden.', 403);
    $data = input();
    require_fields($data, ['employee_id']);

    $empId = (string)$data['employee_id'];
    $emp = findOne(collection('employees'), ['_id' => mongoId($empId)]);
    if (!$emp) fail('Employee not found.', 404);

    $today = date('Y-m-d');
    $nowStr = date('H:i:s');
    $rec = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $today]);
    if (!$rec) fail('Attendance record not found.', 404);
    if (empty($rec['hr_timer_paused']) || empty($rec['break_start_time'])) fail('Employee timer is not paused by HR.', 400);

    updateOne(collection('employees'), ['_id' => mongoId($empId)], [
        'is_paused' => false
    ]);

    $breakStartTs = strtotime($today . ' ' . $rec['break_start_time']);
    $elapsedSecs = max(0, time() - ($breakStartTs ?: time()));
    $newTotal = (int)($rec['total_break_seconds'] ?? 0) + $elapsedSecs;
    updateOne(collection('attendance'), ['_id' => $rec['_id']], [
        'break_start_time' => null,
        'total_break_seconds' => $newTotal,
        'hr_timer_paused' => false,
        'hr_pause_started_at' => null,
        'hr_pause_reason' => null,
        'hr_pause_by' => null,
        'hr_pause_by_name' => null,
        'is_paused' => false,
        'resumed_at' => date('Y-m-d H:i:s'),
        'resumed_by' => $user['id'],
    ]);

    $empName = $emp['name'] ?? 'Employee';
    $resumeRecordId = (string)$rec['_id'] . '_' . str_replace(['-', ' ', ':'], '', date('Y-m-d H:i:s'));

    // 1. Recipient notification to affected employee
    notifyEmployee($empId, 'Timer Resumed by HR', 'Your timer has been resumed by HR.', 'success', [
        'event_id' => "employee_resume_emp:{$empId}:{$resumeRecordId}",
        'event_type' => 'hr_resume_emp.created',
        'source_employee_id' => $empId,
        'speak_text' => 'Your timer has been resumed by HR.',
    ]);

    // 2. Activity Log entry (role => hr, user_id => '')
    createNotification('', 'hr', 'HR Timer Resumed', "{$empName} timer resumed.", 'info', [
        'event_id' => "employee_resume:{$empId}:{$resumeRecordId}",
        'event_type' => 'hr_resume.created',
        'source_employee_id' => $empId,
        'speak_text' => "{$empName} timer resumed.",
    ]);

    $updated = findOne(collection('attendance'), ['_id' => $rec['_id']]);
    if ($updated) $updated['id'] = (string)$updated['_id'];
    ok($updated, 'Employee timer resumed.');
}

if (method() === 'POST' && ($_GET['action'] ?? '') === 'employee_resume_timer') {
    $empId = $user['id'];
    $today = date('Y-m-d');
    $nowStr = date('H:i:s');
    $rec = findOne(collection('attendance'), ['employee_id' => $empId, 'date' => $today]);
    if (!$rec) fail('Attendance record not found.', 404);
    if (empty($rec['is_paused'])) fail('Timer is not paused.', 400);
    if (($rec['hr_pause_by'] ?? '') !== 'system' && ($rec['hr_pause_by'] ?? '') !== '') {
        fail('Timer paused by HR. Only HR can resume this timer.', 403);
    }

    updateOne(collection('employees'), ['_id' => mongoId($empId)], [
        'is_paused' => false
    ]);

    $breakStartTs = strtotime($today . ' ' . $rec['break_start_time']);
    $elapsedSecs = max(0, time() - ($breakStartTs ?: time()));
    $newTotal = (int)($rec['total_break_seconds'] ?? 0) + $elapsedSecs;

    updateOne(collection('attendance'), ['_id' => $rec['_id']], [
        'break_start_time' => null,
        'total_break_seconds' => $newTotal,
        'hr_timer_paused' => false,
        'hr_pause_started_at' => null,
        'hr_pause_reason' => null,
        'hr_pause_by' => null,
        'hr_pause_by_name' => null,
        'is_paused' => false,
        'resumed_at' => date('Y-m-d H:i:s'),
        'resumed_by' => $user['id'],
        'paused_at' => null,
        'paused_by' => null,
        'pause_reason' => null,
    ]);

    $updated = findOne(collection('attendance'), ['_id' => $rec['_id']]);
    if ($updated) $updated['id'] = (string)$updated['_id'];
    ok($updated, 'Timer resumed successfully.');
}

$approvalActions = ['approve_late_checkin', 'reject_late_checkin', 'approve_break', 'reject_break', 'approve_all_breaks', 'hr_pause_timer', 'hr_resume_timer'];
if ($user['role'] === 'hr' && !in_array($_GET['action'] ?? '', $approvalActions, true)) {
    if (method() === 'POST' && isset($_GET['action'])) {
        fail('HR users cannot check in or out.', 403);
    }
}

/* ═══════════════════════════════════════════════════════════════════
   POST — check in
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'checkin') {
    $today  = date('Y-m-d');
    $nowStr = date('H:i:s');
    $nowTs  = strtotime($nowStr);
    $cfg    = attendanceSettings();
    $openTs  = strtotime($cfg['checkin_open'] . ':00');
    $closeTs = strtotime($cfg['checkin_close'] . ':00');
    $lateTs  = strtotime($cfg['late_after'] . ':00');

    // Check duplicate
    $existingRec = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if ($existingRec && ($existingRec['status'] ?? '') !== 'absent') {
        if (!empty($existingRec['check_out']) || !empty($existingRec['is_checked_out'])) {
            if ($nowTs <= $closeTs) {
                $status = !empty($existingRec['check_in']) && strtotime($existingRec['check_in']) > $lateTs ? 'late' : 'present';
                updateOne(collection('attendance'), ['_id' => $existingRec['_id']], [
                    'check_out' => null,
                    'checkout_at' => null,
                    'working_hours' => null,
                    'is_checked_out' => false,
                    'status' => $status,
                    'active_activity_type' => 'working',
                    'last_resumed_at' => date('Y-m-d H:i:s'),
                ]);
                ok(['id' => (string)$existingRec['_id']], 'Check-in resumed after the accidental check-out.');
            }
            fail('You have already checked out today. Request a check-out undo from HR to resume attendance.', 400);
        } else {
            fail('Already checked in today.', 400);
        }
    }

    // Check holiday
    $holiday = findOne(collection('holidays'), ['date' => $today]);
    if ($holiday) fail("Today is a holiday: {$holiday['title']}. No check-in required.", 400);

    if ($nowTs < $openTs) fail("Check-in window not open yet. Opens at {$cfg['checkin_open']} IST.", 400);

    $inputData  = input();
    $lat        = !empty($inputData['lat'])  ? substr((string)$inputData['lat'], 0, 50) : null;
    $lng        = !empty($inputData['lng'])  ? substr((string)$inputData['lng'], 0, 50) : null;
    $accuracy   = isset($inputData['accuracy']) ? substr((string)$inputData['accuracy'], 0, 50) : null;
    $device     = deviceSummary($inputData);
    $userAgent  = substr((string)($inputData['user_agent'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 500);
    $platform   = substr((string)($inputData['platform'] ?? ''), 0, 100);
    $language   = substr((string)($inputData['language'] ?? ''), 0, 50);
    $screen     = substr((string)($inputData['screen'] ?? ''), 0, 50);
    $timezone   = substr((string)($inputData['timezone'] ?? ''), 0, 100);

    // ── WFH Mode Detection ──
    $requestMode = trim((string)($inputData['work_mode'] ?? ''));
    $hasApprovedWfh = false;
    $wfhRequestId = null;
    $activeWfh = findOne(collection('wfh'), [
        'employee_id' => $user['id'],
        'status' => 'approved',
        'start_date' => ['$lte' => $today],
        'end_date' => ['$gte' => $today],
    ]);
    if ($activeWfh) {
        $hasApprovedWfh = true;
        $wfhRequestId = (string)$activeWfh['_id'];
    }

    $mode = 'office';
    if ($requestMode === 'wfh' || $hasApprovedWfh) {
        $mode = 'wfh';
    }

    // Too late — send approval request to HR
    if ($nowTs > $closeTs) {
        $existing = findOne(collection('notifications'), [
            'role'    => 'hr',
            'source_employee_id' => $user['id'],
            'event_type' => 'attendance_approval.created',
            'check_in_date' => $today,
        ]);
        if (!$existing) {
            [$message, $speak] = cleanHrEmployeeMessage($user['id'], 'has requested late check-in approval');
            notifyHr(
                'Late Check-In Approval',
                $message,
                'warning',
                [
                    'event_id' => "attendance_approval:{$user['id']}:{$today}:created",
                    'event_type' => 'attendance_approval.created',
                    'source_employee_id' => $user['id'],
                    'source_request_id' => "{$user['id']}:{$today}",
                    'speak_text' => $speak,
                    'check_in_date' => $today,
                    'check_in_time' => $nowStr,
                    'lat' => $lat,
                    'lng' => $lng,
                    'accuracy' => $accuracy,
                    'device' => $device,
                    'user_agent' => $userAgent
                ]
            );
        }
        fail("Check-in closed at {$cfg['checkin_close']} IST. A request has been sent to HR for approval.", 202);
    }

    $lateMinutes = 0;
    $status      = 'present';
    if ($nowTs > $lateTs) {
        $lateMinutes = (int) ceil(($nowTs - $lateTs) / 60);
        $status      = 'late';
    }

    $taskUpdate = trim((string)($inputData['daily_task_update'] ?? ''));
    try {
        $attendanceRecord = [
            'employee_id'                  => $user['id'],
            'date'                         => $today,
            'check_in'                     => $nowStr,
            'status'                       => $status,
            'late_minutes'                 => $lateMinutes,
            'lunch_late_minutes'           => 0,
            'evening_late_minutes'         => 0,
            'total_break_seconds'          => 0,
            'break_start_time'             => null,
            'mode'                         => $mode,
            'wfh_request_id'               => $wfhRequestId,
            'checkin_lat'                  => $lat,
            'checkin_lng'                  => $lng,
            'checkin_accuracy'             => $accuracy,
            'checkin_device'               => $device,
            'checkin_user_agent'           => $userAgent,
            'checkin_platform'             => $platform ?: null,
            'checkin_language'             => $language ?: null,
            'checkin_screen'               => $screen ?: null,
            'checkin_timezone'             => $timezone ?: null,
            'daily_task_update'            => $taskUpdate !== '' ? $taskUpdate : null,
            'created_at'                   => date('Y-m-d H:i:s'),
            // State Machine Fields
            'active_activity_type'         => 'working',
            'work_mode'                    => $mode,
            'clock_in_at'                  => date('Y-m-d H:i:s'),
            'last_resumed_at'              => date('Y-m-d H:i:s'),
            'is_checked_out'               => false,
            'checkout_at'                  => null,
            'accumulated_work_seconds'     => 0,
            'accumulated_meeting_seconds'  => 0,
            'accumulated_lunch_seconds'    => 0,
            'accumulated_break_seconds'    => 0,
            'accumulated_extended_break_seconds' => 0,
            'wfh_working_seconds'          => 0,
            'office_working_seconds'       => 0,
            'required_work_seconds'        => 28800, // 8 hours
        ];

        if ($existingRec && ($existingRec['status'] ?? '') === 'absent') {
            updateOne(collection('attendance'), ['_id' => $existingRec['_id']], $attendanceRecord);
        } else {
            insertOne(collection('attendance'), $attendanceRecord);
        }

        // Sync employee status to active on check-in
        updateOne(collection('employees'), ['_id' => mongoId($user['id'])], ['status' => 'active']);
    } catch (Exception $e) {
        if ($e->getCode() === 409) fail('Already checked in today.', 400);
        fail('Failed to record check-in.', 500);
    }

    $checkInLabel = date('h:i A', $nowTs) . ' IST';
    notifyHr(
        $status === 'late' ? 'Late Arrival' : 'Employee Check-In',
        "{$user['name']} checked in at {$checkInLabel}" . ($status === 'late' ? " ({$lateMinutes} min late)" : ''),
        $status === 'late' ? 'warning' : 'info'
    );
    $hour = (int)date('H', $nowTs);
    $timeGreeting = $hour < 12 ? 'Good morning' : ($hour < 17 ? 'Good afternoon' : ($hour < 21 ? 'Good evening' : 'Good night'));
    $greeting = $status === 'late'
        ? "You checked in at " . date('h:i A') . " IST — {$lateMinutes} min late."
        : "{$timeGreeting}! Checked in at " . date('h:i A') . " IST. Have a productive day!";
    if ($mode === 'wfh') {
        $greeting .= " Working from home today.";
    }
    notifyEmployee($user['id'], 'Check-In', $greeting);

    ok([
        'id'           => (string) $result['_id'],
        'check_in'     => $nowStr,
        'status'       => $status,
        'late_minutes' => $lateMinutes,
        'mode'         => $mode,
        'lunch_start'  => $cfg['lunch_start'],
        'lunch_end'    => $cfg['lunch_end'],
        'evening_start'=> $cfg['evening_start'],
        'evening_end'  => $cfg['evening_end'],
    ], 'Checked in successfully.', 201);
}

/* ═══════════════════════════════════════════════════════════════════
   POST — check out
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'checkout') {
    $today  = date('Y-m-d');
    $nowStr = date('H:i:s');
    $nowTs  = time();
    $cfg    = attendanceSettings();

    // Materialize any scheduled breaks before finalising time.  Late API
    // refreshes must not turn a one-hour break into several lost work hours.
    syncAutoBreaksForEmployee($user['id']);
    $rec = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if (!$rec)                   fail('No check-in record found for today.', 400);
    if (!empty($rec['is_checked_out']) || !empty($rec['check_out'])) fail('Already checked out today.', 400);

    // 1. Enforce auto-closing of any active activity (meeting, lunch, or break)
    $activeType = $rec['active_activity_type'] ?? 'working';
    if ($activeType !== 'working') {
        $rec = transitionActivity($rec, 'working', $nowTs);
        
        // If it was a break, complete the session in break_sessions collection
        if ($activeType === 'lunch' || $activeType === 'break') {
            $session = findOne(collection('break_sessions'), [
                'employee_id' => $user['id'],
                'attendance_id' => (string)$rec['_id'],
                'status' => ['$in' => ['active', 'extended']]
            ]);
            if ($session) {
                $startedAtTs = strtotime($session['started_at']);
                $actualSecs = max(0, $nowTs - $startedAtTs);
                $allowedSecs = strtotime($session['expected_end_at']) - $startedAtTs;
                $extendedSecs = max(0, $actualSecs - $allowedSecs);
                
                updateOne(collection('break_sessions'), ['_id' => $session['_id']], [
                    'ended_at' => date('Y-m-d H:i:s', $nowTs),
                    'status' => 'completed',
                    'updated_at' => date('Y-m-d H:i:s')
                ]);
                $rec['accumulated_extended_break_seconds'] = (int)($rec['accumulated_extended_break_seconds'] ?? 0) + $extendedSecs;
            }
        }
    }

    // 2. Final transition to checked_out
    $rec = transitionActivity($rec, 'checked_out', $nowTs);
    $rec['is_checked_out'] = true;
    $rec['checkout_at'] = date('Y-m-d H:i:s', $nowTs);

    // 3. Compute final metrics
    $live = getLiveAttendance($rec);
    $rec = syncLegacyFields($rec, $nowTs);
    
    // Check early checkout
    $openTs  = strtotime($today . ' ' . $cfg['checkout_open'] . ':00');
    $closeTs = strtotime($today . ' ' . $cfg['checkout_close'] . ':00');
    $status  = 'present';
    $earlyFlag = false;
    $adjustFlag = false;
    if ($nowTs < $openTs) {
        $status    = 'early_checkout';
        $earlyFlag = true;
    } elseif ($nowTs > $closeTs) {
        $adjustFlag = true;
    }
    if (($rec['status'] ?? 'present') === 'late' && !$earlyFlag) $status = 'late';
    
    $rec['status'] = $status;
    $rec['check_out'] = $nowStr;

    // Update record in database
    updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);

    // Sync employee status to inactive on check-out (Disabled to prevent employees from becoming inactive in the DB after checkout)
    // updateOne(collection('employees'), ['_id' => mongoId($user['id'])], ['status' => 'inactive']);

    if ($earlyFlag) {
        notifyHr(
            'Early Checkout',
            "{$user['name']} checked out early at " . date('h:i A') . " IST (worked {$rec['working_hours']} net hrs)",
            'warning',
            [
                'event_id' => "early_checkout:{$user['id']}:{$today}:created",
                'event_type' => 'early_checkout.created',
                'source_id' => "{$user['id']}:{$today}",
                'speak_text' => "{$user['name']} has requested early checkout.",
            ]
        );
    }

    $msg = "Checked out at " . date('h:i A') . " IST. Net hours worked excluding breaks: {$rec['working_hours']}.";
    if ($adjustFlag) $msg .= ' (Overtime recorded.)';
    notifyEmployee($user['id'], 'Check-Out', $msg);

    ok(['id' => (string)$rec['_id'], 'check_out' => $nowStr, 'working_hours' => $rec['working_hours'], 'status' => $status, 'adjusted' => $adjustFlag], 'Checked out successfully.');
}

/* ═══════════════════════════════════════════════════════════════════
   POST — start meeting (instant)
   ══════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'start_meeting') {
    $today  = date('Y-m-d');
    $nowStr = date('H:i:s');
    $nowTs  = time();

    $rec = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if (!$rec)                         fail('No check-in record found for today.', 400);
    if (!empty($rec['is_checked_out']) || !empty($rec['check_out'])) fail('Already checked out.', 400);

    $activeType = $rec['active_activity_type'] ?? 'working';
    if ($activeType !== 'working' && $activeType !== 'lunch' && $activeType !== 'break') {
        fail("Cannot start a meeting while in state: {$activeType}.", 400);
    }

    if ($activeType === 'lunch' || $activeType === 'break') {
        $rec['activity_paused_by_meeting'] = $activeType;
        $rec['meeting_start_during_break_at'] = date('Y-m-d H:i:s', $nowTs);
    }

    $rec = transitionActivity($rec, 'meeting', $nowTs);
    $rec = syncLegacyFields($rec, $nowTs);
    updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);

    notifyEmployee($user['id'], 'Meeting Started', 'Your meeting has started.', 'success', [
        'event_id' => 'meeting_start:' . $user['id'] . ':' . $today . ':' . time(),
        'event_type' => 'meeting.started',
        'speak_text' => 'Your meeting has started.',
    ]);

    ok(getLiveAttendance($rec), 'Meeting started successfully.');
}

/* ═══════════════════════════════════════════════════════════════════
   POST — end meeting (instant)
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'end_meeting') {
    $today  = date('Y-m-d');
    $nowStr = date('H:i:s');
    $nowTs  = time();

    $rec = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if (!$rec)                         fail('No check-in record found for today.', 400);
    if (!empty($rec['is_checked_out']) || !empty($rec['check_out'])) fail('Already checked out.', 400);

    $activeType = $rec['active_activity_type'] ?? 'working';
    if ($activeType !== 'meeting') {
        fail('No active meeting session to end.', 400);
    }

    $pausedType = $rec['activity_paused_by_meeting'] ?? null;
    $nextType = 'working';

    if ($pausedType) {
        $nextType = $pausedType;
        $meetingStartStr = $rec['meeting_start_during_break_at'] ?? null;
        if ($meetingStartStr) {
            $meetingStartTs = strtotime($meetingStartStr);
            $meetingDurationSecs = max(0, $nowTs - $meetingStartTs);
            $meetingDurationMins = (int)ceil($meetingDurationSecs / 60);

            // Find active break session
            $breakSess = findOne(collection('break_sessions'), [
                'employee_id' => $user['id'],
                'attendance_id' => (string)$rec['_id'],
                'status' => ['$in' => ['active', 'extended']]
            ]);
            if ($breakSess) {
                $newExpectedEnd = date('Y-m-d H:i:s', strtotime($breakSess['expected_end_at']) + $meetingDurationSecs);
                updateOne(collection('break_sessions'), ['_id' => $breakSess['_id']], [
                    'expected_end_at' => $newExpectedEnd,
                    'extension_minutes' => ($breakSess['extension_minutes'] ?? 0) + $meetingDurationMins,
                    'extension_reason' => 'Auto-extended due to meeting during break.',
                    'updated_at' => date('Y-m-d H:i:s')
                ]);

                // Notify employee that their break has been extended
                notifyEmployee($user['id'], 'Break Extended', "Your break has been extended by {$meetingDurationMins} minutes due to the meeting.", 'info', [
                    'event_id' => 'break_extend_auto:' . $user['id'] . ':' . $today . ':' . time(),
                    'event_type' => 'break.extended',
                    'speak_text' => "Your break has been extended by {$meetingDurationMins} minutes.",
                ]);
            }
        }
        unset($rec['activity_paused_by_meeting']);
        unset($rec['meeting_start_during_break_at']);
    }

    $rec = transitionActivity($rec, $nextType, $nowTs);
    $rec = syncLegacyFields($rec, $nowTs);
    updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);

    notifyEmployee($user['id'], 'Meeting Ended', 'Your meeting has ended.', 'success', [
        'event_id' => 'meeting_end:' . $user['id'] . ':' . $today . ':' . time(),
        'event_type' => 'meeting.ended',
        'speak_text' => 'Your meeting has ended.',
    ]);

    ok(getLiveAttendance($rec), 'Meeting ended successfully.');
}

/* ═══════════════════════════════════════════════════════════════════
   POST — request checkout undo
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'request_checkout_undo') {
    $today  = date('Y-m-d');
    $nowStr = date('H:i:s');
    $rec    = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if (!$rec)                      fail('No attendance record found for today.', 400);
    if (empty($rec['check_out']))   fail('You have not checked out yet.', 400);

    $existing = findOne(collection('break_requests'), ['employee_id' => $user['id'], 'date' => $today, 'status' => 'pending', 'request_type' => 'checkout_undo']);
    if ($existing) fail('You already have a pending check-out undo request.', 400);

    $request = insertOne(collection('break_requests'), [
        'employee_id'  => $user['id'],
        'date'         => $today,
        'request_time' => $nowStr,
        'request_type' => 'checkout_undo',
        'status'       => 'pending',
        'created_at'   => date('Y-m-d H:i:s'),
    ]);
    [$message, $speak] = cleanHrEmployeeMessage($user['id'], 'has requested to undo checkout');
    notifyHr(
        'Check-Out Undo Request',
        $message,
        'warning',
        [
            'event_id' => 'checkout_undo_request:' . (string)$request['_id'] . ':created',
            'event_type' => 'checkout_undo_request.created',
            'source_employee_id' => $user['id'],
            'source_request_id' => (string)$request['_id'],
            'speak_text' => $speak,
        ]
    );
    ok(null, 'Check-out undo request sent to HR.');
}

/* ═══════════════════════════════════════════════════════════════════
   POST — start break / request meeting
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'request_meeting') {
    $today      = date('Y-m-d');
    $nowStr     = date('H:i:s');
    $nowTs      = time();
    $cfg        = attendanceSettings();

    $rec = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if (!$rec)                         fail('No check-in record found for today.', 400);
    if (!empty($rec['check_out']))     fail('Already checked out. Cannot start break.', 400);
    if (!empty($rec['break_start_time'])) fail('Already on break.', 400);

    $existing = findOne(collection('break_requests'), ['employee_id' => $user['id'], 'date' => $today, 'status' => 'pending', 'request_type' => 'meeting']);
    if ($existing) fail("You already have a pending meeting request.", 400);

    insertOne(collection('break_requests'), [
        'employee_id'  => $user['id'],
        'date'         => $today,
        'request_time' => $nowStr,
        'request_type' => 'meeting',
        'status'       => 'pending',
        'created_at'   => date('Y-m-d H:i:s'),
    ]);
    notifyHr('Meeting Request', "{$user['name']} requested a meeting at " . date('h:i A'), 'info');
    ok(['pending_approval' => true, 'request_type' => 'meeting'], 'Meeting request sent to HR for approval.', 202);
}

if (method() === 'POST' && ($_GET['action'] ?? '') === 'request_break') {
    $today = date('Y-m-d');
    $nowStr = date('H:i:s');
    $data = input();

    $breakType = trim((string)($data['break_type'] ?? 'manual'));
    $requestedMinutes = (int)($data['requested_minutes'] ?? 0);
    $reason = trim((string)($data['reason'] ?? ''));

    if (!in_array($breakType, ['lunch', 'evening', 'manual'], true)) {
        fail('Invalid break type.', 422);
    }
    if (!in_array($requestedMinutes, allowedBreakMinutes(), true)) {
        fail('Invalid requested duration.', 422);
    }
    if ($reason === '') {
        fail('Break reason is required.', 422);
    }

    syncAutoBreaksForEmployee($user['id']);
    $rec = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if (!$rec) fail('No check-in record found for today.', 400);
    if (!empty($rec['check_out'])) fail('Already checked out. Cannot request break.', 400);

    $activeSess = findOne(collection('break_sessions'), [
        'employee_id' => $user['id'],
        'attendance_id' => (string)$rec['_id'],
        'status' => ['$in' => ['active', 'extended']]
    ]);

    if ($breakType === 'manual' && $activeSess) {
        fail('Manual break cannot be requested while another break is active.', 400);
    }
    if ($breakType !== 'manual' && (!$activeSess || ($activeSess['break_type'] ?? '') !== $breakType)) {
        fail('Extension request is only available during the active break.', 400);
    }

    $existing = findOne(collection('break_requests'), [
        'employee_id' => $user['id'],
        'date' => $today,
        'status' => 'pending',
        'break_type' => $breakType
    ]);
    if ($existing) fail('You already have a pending request for this break.', 400);

    $requestType = $breakType === 'manual' ? 'break' : $breakType . '_break';
    $request = insertOne(collection('break_requests'), [
        'employee_id' => $user['id'],
        'attendance_id' => (string)$rec['_id'],
        'date' => $today,
        'request_time' => $nowStr,
        'request_type' => $requestType,
        'break_type' => $breakType,
        'requested_minutes' => $requestedMinutes,
        'approved_minutes' => null,
        'reason' => $reason,
        'status' => 'pending',
        'approved_by' => null,
        'approved_at' => null,
        'created_at' => date('Y-m-d H:i:s'),
    ]);

    $label = $breakType === 'manual' ? 'Manual Break' : ucfirst($breakType) . ' Break Extension';
    $eventType = $breakType === 'manual' ? 'manual_break_request.created' : $breakType . '_extension_request.created';
    $speakLabel = $breakType === 'manual'
        ? 'a ' . $requestedMinutes . ' minute break'
        : ($breakType === 'lunch' ? 'additional lunch break time' : 'additional evening break time');
    [$message, $speak] = cleanHrEmployeeMessage($user['id'], 'has requested a break');
    notifyHr(
        $label . ' Request',
        $message,
        'warning',
        [
            'event_id' => 'break_request:' . (string)$request['_id'] . ':created',
            'event_type' => $eventType,
            'source_employee_id' => $user['id'],
            'source_request_id' => (string)$request['_id'],
            'speak_text' => $speak,
            'visual_reason' => $reason,
        ]
    );
    ok(['pending_approval' => true, 'break_type' => $breakType], "{$label} request sent to HR.", 202);
}

if (method() === 'POST' && ($_GET['action'] ?? '') === 'start_break') {
    $today  = date('Y-m-d');
    $nowStr = date('H:i:s');
    $nowTs  = time();
    $cfg    = attendanceSettings();

    $data = input();
    $breakType = trim((string)($data['break_type'] ?? 'lunch'));
    if (!in_array($breakType, ['lunch', 'evening'], true)) {
        fail('Invalid break type.', 422);
    }

    $rec = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if (!$rec) fail('No check-in record found for today.', 400);
    if (!empty($rec['is_checked_out']) || !empty($rec['check_out'])) fail('Already checked out. Cannot start break.', 400);

    $activeType = $rec['active_activity_type'] ?? 'working';
    if ($activeType !== 'working') {
        fail("Cannot start a break while in state: {$activeType}.", 400);
    }

    $activeSess = findOne(collection('break_sessions'), [
        'employee_id' => $user['id'],
        'attendance_id' => (string)$rec['_id'],
        'status' => ['$in' => ['active', 'extended']]
    ]);
    if ($activeSess) fail('Cannot start a break while another break is active.', 400);

    if ($breakType === 'lunch') {
        $lunchStartTs = strtotime($today . ' 13:30:00');
        if ($nowTs < $lunchStartTs) {
            fail('Lunch break cannot be started before 1:30 PM IST.', 400);
        }

        $existingLunch = findOne(collection('break_sessions'), [
            'employee_id' => $user['id'],
            'attendance_id' => (string)$rec['_id'],
            'break_type' => 'lunch'
        ]);
        if ($existingLunch) fail('Cannot start lunch break twice.', 400);

        $allowedDuration = 60 * 60; // 60 mins
        $lateStartMins = 0;
        if ($nowTs > $lunchStartTs) {
            $lateStartMins = (int)ceil(($nowTs - $lunchStartTs) / 60);
        }

        $expectedEndAt = $nowTs + $allowedDuration;

        $session = [
            'employee_id' => $user['id'],
            'attendance_id' => (string)$rec['_id'],
            'break_type' => 'lunch',
            'started_at' => date('Y-m-d H:i:s', $nowTs),
            'expected_end_at' => date('Y-m-d H:i:s', $expectedEndAt),
            'ended_at' => null,
            'extension_minutes' => 0,
            'extension_reason' => null,
            'extended_by' => null,
            'extended_at' => null,
            'late_start_minutes' => $lateStartMins,
            'late_return_minutes' => 0,
            'status' => 'active',
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s')
        ];
        
        $saved = insertOne(collection('break_sessions'), $session);

        $rec = transitionActivity($rec, 'lunch', $nowTs);
        $rec['break_start_time'] = $nowStr;
        $rec = syncLegacyFields($rec, $nowTs);
        updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);

        [$message, $speak] = cleanHrEmployeeMessage($user['id'], 'started lunch break');
        notifyHr(
            'Lunch Break Started',
            $message,
            'info',
            [
                'event_id' => "break_start:{$user['id']}:{$today}:lunch:" . time(),
                'event_type' => 'break.started',
                'source_employee_id' => $user['id'],
                'source_request_id' => (string)$saved['_id'],
                'speak_text' => $speak,
            ]
        );

        if ($lateStartMins > 0) {
            $existingNotif = findOne(collection('notifications'), [
                'role' => 'hr',
                'source_employee_id' => $user['id'],
                'event_type' => 'late_lunch_start',
                'late_lunch_date' => $today,
            ]);
            if (!$existingNotif) {
                [$message, $speak] = cleanHrEmployeeMessage($user['id'], 'started lunch break late');
                dbNotifyHr(
                    'Late Lunch Start',
                    $message,
                    'warning',
                    [
                        'event_id' => "late_lunch_start:{$user['id']}:{$today}:created",
                        'event_type' => 'late_lunch_start',
                        'source_employee_id' => $user['id'],
                        'speak_text' => $speak,
                        'late_lunch_date' => $today,
                    ]
                );
            }
        }

        ok([
            'session_id' => (string)$saved['_id'],
            'break_type' => 'lunch',
            'started_at' => date('Y-m-d H:i:s', $nowTs),
            'expected_end_at' => date('Y-m-d H:i:s', $expectedEndAt),
            'late_start_minutes' => $lateStartMins
        ], 'Lunch break started successfully.');

    } else {
        $eveStartTs = strtotime($today . ' 16:30:00');
        if ($nowTs < $eveStartTs) {
            fail('Evening break cannot be started before 4:30 PM IST.', 400);
        }

        $existingEve = findOne(collection('break_sessions'), [
            'employee_id' => $user['id'],
            'attendance_id' => (string)$rec['_id'],
            'break_type' => 'evening'
        ]);
        if ($existingEve) fail('Cannot start evening break twice.', 400);

        $allowedDuration = 30 * 60; // 30 mins
        $lateStartMins = 0;
        if ($nowTs > $eveStartTs) {
            $lateStartMins = (int)ceil(($nowTs - $eveStartTs) / 60);
        }

        $expectedEndAt = $nowTs + $allowedDuration;

        $session = [
            'employee_id' => $user['id'],
            'attendance_id' => (string)$rec['_id'],
            'break_type' => 'evening',
            'started_at' => date('Y-m-d H:i:s', $nowTs),
            'expected_end_at' => date('Y-m-d H:i:s', $expectedEndAt),
            'ended_at' => null,
            'extension_minutes' => 0,
            'extension_reason' => null,
            'extended_by' => null,
            'extended_at' => null,
            'late_start_minutes' => $lateStartMins,
            'late_return_minutes' => 0,
            'status' => 'active',
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s')
        ];
        
        $saved = insertOne(collection('break_sessions'), $session);

        $rec = transitionActivity($rec, 'break', $nowTs);
        $rec['break_start_time'] = $nowStr;
        $rec = syncLegacyFields($rec, $nowTs);
        updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);

        [$message, $speak] = cleanHrEmployeeMessage($user['id'], 'started evening break');
        notifyHr(
            'Evening Break Started',
            $message,
            'info',
            [
                'event_id' => "break_start:{$user['id']}:{$today}:evening:" . time(),
                'event_type' => 'break.started',
                'source_employee_id' => $user['id'],
                'source_request_id' => (string)$saved['_id'],
                'speak_text' => $speak,
            ]
        );

        ok([
            'session_id' => (string)$saved['_id'],
            'break_type' => 'evening',
            'started_at' => date('Y-m-d H:i:s', $nowTs),
            'expected_end_at' => date('Y-m-d H:i:s', $expectedEndAt),
            'late_start_minutes' => $lateStartMins
        ], 'Evening break started successfully.');
    }
}

/* ═══════════════════════════════════════════════════════════════════
   POST — end break
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'end_break') {
    $today  = date('Y-m-d');
    $nowStr = date('H:i:s');
    $nowTs  = time();

    $rec = findOne(collection('attendance'), ['employee_id' => $user['id'], 'date' => $today]);
    if (!$rec) fail('No check-in record found for today.', 400);

    // Check if user is in a meeting state
    if (($rec['active_activity_type'] ?? '') === 'meeting') {
        $rec = transitionActivity($rec, 'working', $nowTs);
        $rec['is_paused'] = false;
        $rec['pause_reason'] = null;
        $rec['paused_at'] = null;
        $rec = syncLegacyFields($rec, $nowTs);
        updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);
        notifyEmployee($user['id'], 'Meeting Ended', 'Your meeting has ended.', 'success', [
            'event_id' => 'meeting_end:' . $user['id'] . ':' . $today . ':' . time(),
            'event_type' => 'meeting.ended',
            'speak_text' => 'Your meeting has ended.',
        ]);
        ok(getLiveAttendance($rec), 'Meeting ended successfully.');
    }

    $session = findOne(collection('break_sessions'), [
        'employee_id' => $user['id'],
        'attendance_id' => (string)$rec['_id'],
        'status' => ['$in' => ['active', 'extended']]
    ]);
    if (!$session) fail('Not currently on a break.', 400);

    $startedAtTs = strtotime($session['started_at']);
    $actualSecs = max(0, $nowTs - $startedAtTs);
    $expectedEndTs = strtotime($session['expected_end_at']);
    $allowedSecs = $expectedEndTs - $startedAtTs;
    $extendedSecs = max(0, $actualSecs - $allowedSecs);

    $lateReturnMins = 0;
    if ($nowTs > $expectedEndTs) {
        $lateReturnMins = (int)ceil(($nowTs - $expectedEndTs) / 60);
    }

    // Transition activity to working
    $rec = transitionActivity($rec, 'working', $nowTs);
    $rec['accumulated_extended_break_seconds'] = (int)($rec['accumulated_extended_break_seconds'] ?? 0) + $extendedSecs;
    $rec['break_start_time'] = null;
    $rec = syncLegacyFields($rec, $nowTs);

    if ($lateReturnMins > 0) {
        // Late return: Mark break session status as 'late_return'
        updateOne(collection('break_sessions'), ['_id' => $session['_id']], [
            'ended_at' => date('Y-m-d H:i:s', $nowTs),
            'late_return_minutes' => $lateReturnMins,
            'status' => 'late_return',
            'updated_at' => date('Y-m-d H:i:s')
        ]);

        // Save updated attendance
        updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);

        // Create HR approval request
        $request = insertOne(collection('break_requests'), [
            'employee_id' => $user['id'],
            'attendance_id' => (string)$rec['_id'],
            'date' => $today,
            'request_time' => $nowStr,
            'request_type' => 'late_return',
            'break_type' => $session['break_type'],
            'requested_minutes' => $lateReturnMins,
            'reason' => 'Late break return approval required',
            'status' => 'pending',
            'approved_by' => null,
            'approved_at' => null,
            'created_at' => date('Y-m-d H:i:s'),
        ]);

        // Notify Employee
        notifyEmployee($user['id'], 'Late Return Request Sent', 'You returned late from break. HR approval is required.', 'warning', [
            'event_id' => 'late_break_return_emp:' . $user['id'] . ':' . $today . ':' . time(),
            'event_type' => 'late_break_return_emp.created',
            'source_employee_id' => $user['id'],
            'source_request_id' => (string)$request['_id'],
            'speak_text' => 'Your late break return has been sent to HR.',
        ]);

        // Notify HR (name-only)
        [$message, $speak] = cleanHrEmployeeMessage($user['id'], 'returned late from break');
        notifyHr('Late Break Return', $message, 'warning', [
            'event_id' => 'late_break_return:' . $user['id'] . ':' . $today . ':' . time(),
            'event_type' => 'late_break_return.created',
            'source_employee_id' => $user['id'],
            'source_request_id' => (string)$request['_id'],
            'speak_text' => $speak,
        ]);

        $live = getLiveAttendance($rec);
        ok(array_merge($live, [
            'late_return_pending' => true
        ]), 'You returned late from break. HR approval is required.');

    } else {
        // On-time return: Complete normally
        updateOne(collection('break_sessions'), ['_id' => $session['_id']], [
            'ended_at' => date('Y-m-d H:i:s', $nowTs),
            'late_return_minutes' => 0,
            'status' => 'completed',
            'updated_at' => date('Y-m-d H:i:s')
        ]);

        // Save updated attendance
        updateOne(collection('attendance'), ['_id' => $rec['_id']], $rec);

        // Notify Employee
        notifyEmployee($user['id'], 'Break Ended', 'Your break has ended.', 'success', [
            'event_id' => 'break_end:' . $user['id'] . ':' . $today . ':' . ($session['break_type'] ?? 'break') . ':' . time(),
            'event_type' => 'break.ended',
            'speak_text' => 'Your break has ended.',
        ]);

        ok(getLiveAttendance($rec), 'Break ended successfully.');
    }
}

/* ═══════════════════════════════════════════════════════════════════
   POST — HR extend break
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'extend_break') {
    if ($user['role'] !== 'hr') fail('Forbidden.', 403);
    $data = input();
    require_fields($data, ['employee_id', 'extension_minutes']);
    
    $empId = (string)$data['employee_id'];
    $extMins = (int)$data['extension_minutes'];
    $reason = trim((string)($data['extension_reason'] ?? ''));
    if ($reason === '') {
        $reason = 'Extended by HR';
    }

    if (!in_array($extMins, allowedBreakMinutes(), true)) {
        fail('Invalid extension duration.', 422);
    }

    $session = findOne(collection('break_sessions'), [
        'employee_id' => $empId,
        'status' => ['$in' => ['active', 'extended']]
    ]);
    if (!$session) fail('Active break session not found for this employee.', 404);

    $oldExpectedEnd = strtotime($session['expected_end_at']);
    $newExpectedEnd = $oldExpectedEnd + ($extMins * 60);

    updateOne(collection('break_sessions'), ['_id' => $session['_id']], [
        'expected_end_at' => date('Y-m-d H:i:s', $newExpectedEnd),
        'extension_minutes' => (int)($session['extension_minutes'] ?? 0) + $extMins,
        'extension_reason' => $reason,
        'extended_by' => $user['id'],
        'extended_at' => date('Y-m-d H:i:s'),
        'status' => 'extended',
        'updated_at' => date('Y-m-d H:i:s')
    ]);

    $newFormattedTime = date('h:i A', $newExpectedEnd);
    notifyEmployee(
        $empId,
        'Break Extended',
        "HR extended your {$session['break_type']} break by {$extMins} minutes. New expected return is {$newFormattedTime} IST.",
        'success'
    );

    [$message, $speak] = cleanHrEmployeeMessage($empId, "had their break extended by {$extMins} minutes");
    dbNotifyHr(
        'Break Extension',
        $message,
        'success',
        [
            'event_id' => "break_extension:{$empId}:" . date('Y-m-d') . ':' . time(),
            'event_type' => 'break_extension.created',
            'source_employee_id' => $empId,
            'speak_text' => $speak,
        ]
    );

    ok([
        'session_id' => (string)$session['_id'],
        'expected_end_at' => date('Y-m-d H:i:s', $newExpectedEnd),
        'extension_minutes' => (int)($session['extension_minutes'] ?? 0) + $extMins
    ], 'Break extended successfully.');
}

/* ═══════════════════════════════════════════════════════════════════
   POST — approve late check-in (HR)
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'approve_late_checkin') {
    if ($user['role'] !== 'hr') fail('Forbidden.', 403);
    $data = input();
    require_fields($data, ['notification_id']);

    $notif = findOne(collection('notifications'), ['_id' => mongoId($data['notification_id']), 'role' => 'hr', 'title' => 'Late Check-In Approval']);
    if (!$notif) fail('Late check-in request not found.', 404);

    if (str_contains((string)$notif['message'], ';decision=approved')) {
        fail('Late check-in request is already approved.', 400);
    }
    if (str_contains((string)$notif['message'], ';decision=rejected')) {
        fail('Rejected late check-ins cannot be approved. Update attendance manually if needed.', 400);
    }
    $empId = (string)($notif['source_employee_id'] ?? '');
    $date  = $notif['check_in_date'] ?? '';
    $time  = $notif['check_in_time'] ?? '';
    if (!$empId || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !preg_match('/^\d{2}:\d{2}:\d{2}$/', $time)) {
        fail('Late check-in request is invalid.', 422);
    }

    $emp = findOne(collection('employees'), ['_id' => mongoId($empId), 'status' => 'active']);
    if (!$emp) fail('Employee not found or inactive.', 404);

    $cfg         = attendanceSettings();
    $lateMinutes = max(1, (int)ceil((strtotime($time) - strtotime($cfg['late_after'] . ':00')) / 60));

    try {
        upsertOne(collection('attendance'), ['employee_id' => $empId, 'date' => $date], [
            'employee_id'         => $empId,
            'date'                => $date,
            'check_in'            => $time,
            'status'              => 'late',
            'late_minutes'        => $lateMinutes,
            'total_break_seconds' => 0,
            'lunch_late_minutes'  => 0,
            'evening_late_minutes'=> 0,
        ]);
    } catch (Exception $e) {
        fail('Failed to record approved check-in.', 500);
    }

    updateOne(collection('notifications'), ['_id' => $notif['_id']], [
        'message' => $baseMsg . ';decision=approved',
        'type'    => 'success',
        'is_read' => true,
    ]);
    notifyEmployee(
        $empId,
        'Late Check-In Approved',
        'Your request has been approved.',
        'success',
        [
            'event_id' => 'attendance_approval:' . (string)$notif['_id'] . ':approved:' . $empId,
            'event_type' => 'attendance_approval.approved',
            'source_employee_id' => $empId,
            'source_request_id' => (string)$notif['_id'],
            'speak_text' => 'Your request has been approved.',
        ]
    );
    ok(['employee_id' => $empId, 'date' => $date, 'check_in' => $time], 'Late check-in approved.');
}

/* ═══════════════════════════════════════════════════════════════════
   POST — reject late check-in (HR)
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'reject_late_checkin') {
    if ($user['role'] !== 'hr') fail('Forbidden.', 403);
    $data = input();
    require_fields($data, ['notification_id']);

    $notif = findOne(collection('notifications'), ['_id' => mongoId($data['notification_id']), 'role' => 'hr', 'title' => 'Late Check-In Approval']);
    if (!$notif) fail('Late check-in request not found.', 404);

    $baseMsg = cleanMsg((string)$notif['message']);
    if (str_contains((string)$notif['message'], ';decision=approved')) {
        fail('Approved late check-ins cannot be rejected. Update attendance manually if needed.', 400);
    }
    $empId = (string)($notif['source_employee_id'] ?? '');
    if (!$empId) fail('Late check-in request is invalid.', 422);

    updateOne(collection('notifications'), ['_id' => $notif['_id']], [
        'message' => $baseMsg . ';decision=rejected',
        'type'    => 'error',
        'is_read' => true,
    ]);
    notifyEmployee(
        $empId,
        'Late Check-In Rejected',
        'Your request has been rejected.',
        'error',
        [
            'event_id' => 'attendance_approval:' . (string)$notif['_id'] . ':rejected:' . $empId,
            'event_type' => 'attendance_approval.rejected',
            'source_employee_id' => $empId,
            'source_request_id' => (string)$notif['_id'],
            'speak_text' => 'Your request has been rejected.',
        ]
    );
    ok(null, 'Late check-in rejected.');
}

/* ═══════════════════════════════════════════════════════════════════
   POST — approve break (HR)
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'approve_break') {
    if ($user['role'] !== 'hr') fail('Forbidden.', 403);
    $data = input();
    require_fields($data, ['request_id']);

    $req = findOne(collection('break_requests'), ['_id' => mongoId($data['request_id']), 'status' => 'pending']);
    if (!$req) fail('Pending break request not found.', 404);

    if (($req['request_type'] ?? '') === 'checkout_undo') {
        $att = findOne(collection('attendance'), ['employee_id' => $req['employee_id'], 'date' => $req['date']]);
        if ($att) {
            $cfg       = attendanceSettings();
            $newStatus = strtotime($att['check_in']) > strtotime($cfg['late_after'] . ':00') ? 'late' : 'present';
            updateOne(collection('attendance'), ['_id' => $att['_id']], [
                'check_out' => null,
                'working_hours' => null,
                'status' => $newStatus,
                'is_checked_out' => false,
                'checkout_at' => null,
                'active_activity_type' => 'working',
                'last_resumed_at' => date('Y-m-d H:i:s'),
            ]);
        }
        updateOne(collection('break_requests'), ['_id' => mongoId($data['request_id'])], [
            'status' => 'approved',
            'approved_by' => $user['id'],
            'approved_at' => date('Y-m-d H:i:s')
        ]);
        notifyEmployee(
            (string)$req['employee_id'],
            'Check-Out Undo Approved',
            'Your request has been approved.',
            'success',
            [
                'event_id' => 'checkout_undo_request:' . (string)$req['_id'] . ':approved:' . (string)$req['employee_id'],
                'event_type' => 'checkout_undo_request.approved',
                'source_employee_id' => (string)$req['employee_id'],
                'source_request_id' => (string)$req['_id'],
                'speak_text' => 'Your request has been approved.',
            ]
        );
        ok(null, 'Check-out undo approved.');
    }

    if (($req['request_type'] ?? '') === 'late_return') {
        updateOne(collection('break_requests'), ['_id' => $req['_id']], [
            'status' => 'approved',
            'approved_by' => $user['id'],
            'approved_at' => date('Y-m-d H:i:s'),
        ]);

        $session = findOne(collection('break_sessions'), [
            'employee_id' => (string)$req['employee_id'],
            'attendance_id' => $req['attendance_id'],
            'break_type' => $req['break_type'],
            'status' => 'late_return'
        ]);
        if ($session) {
            updateOne(collection('break_sessions'), ['_id' => $session['_id']], [
                'status' => 'completed',
                'updated_at' => date('Y-m-d H:i:s')
            ]);
        }

        notifyEmployee(
            (string)$req['employee_id'],
            'Late Break Return Approved',
            'Your break request has been approved.',
            'success',
            [
                'event_id' => 'late_return_approved:' . (string)$req['_id'] . ':approved:' . (string)$req['employee_id'],
                'event_type' => 'late_return.approved',
                'source_employee_id' => (string)$req['employee_id'],
                'source_request_id' => (string)$req['_id'],
                'speak_text' => 'Your break request has been approved.',
            ]
        );
        ok(null, 'Late break return approved.');
    }

    if (($req['request_type'] ?? '') === 'meeting') {
        $att = findOne(collection('attendance'), ['employee_id' => $req['employee_id'], 'date' => $req['date']]);
        if ($att && empty($att['check_out'])) {
            $att = transitionActivity($att, 'meeting', time());
            $att['is_paused'] = true;
            $att['pause_reason'] = 'In meeting';
            $att['paused_at'] = date('Y-m-d H:i:s');
            $att = syncLegacyFields($att, time());
            updateOne(collection('attendance'), ['_id' => $att['_id']], $att);
        }
        updateOne(collection('break_requests'), ['_id' => mongoId($data['request_id'])], [
            'status' => 'approved',
            'approved_by' => $user['id'],
            'approved_at' => date('Y-m-d H:i:s'),
        ]);
        notifyEmployee(
            (string)$req['employee_id'],
            'Meeting Request Approved',
            'Your meeting request has been approved.',
            'success',
            [
                'event_id' => 'meeting_request:' . (string)$req['_id'] . ':approved:' . (string)$req['employee_id'],
                'event_type' => 'meeting_request.approved',
                'source_employee_id' => (string)$req['employee_id'],
                'source_request_id' => (string)$req['_id'],
                'speak_text' => 'Your meeting request has been approved.',
            ]
        );
        ok(null, 'Meeting request approved.');
    }

    $att = findOne(collection('attendance'), ['employee_id' => $req['employee_id'], 'date' => $req['date']]);
    if (!$att || !empty($att['check_out'])) fail('Employee is not currently checked in.', 400);

    $breakType = normaliseBreakType($req);
    $approvedMin = isset($data['approved_minutes'])
        ? (int)$data['approved_minutes']
        : (isset($data['duration_minutes']) ? (int)$data['duration_minutes'] : (int)($req['requested_minutes'] ?? 30));
    if (!in_array($approvedMin, allowedBreakMinutes(), true)) {
        fail('Invalid approved duration.', 422);
    }

    if ($breakType === 'manual') {
        $session = startBreakSessionForAttendance($att, (string)$req['employee_id'], 'manual', $approvedMin, time());
        if (!$session) fail('Employee already has an active break.', 400);
        // startBreakSessionForAttendance owns the timer transition. Applying
        // a second transition here could overwrite its accumulated work time.
        $att = findOne(collection('attendance'), ['_id' => $att['_id']]) ?? $att;
    } else {
        $session = findOne(collection('break_sessions'), [
            'employee_id' => (string)$req['employee_id'],
            'attendance_id' => (string)$att['_id'],
            'break_type' => $breakType,
            'status' => ['$in' => ['active', 'extended']]
        ]);
        if (!$session) fail('Active break session not found for this extension request.', 404);

        $oldExpectedEnd = strtotime((string)$session['expected_end_at']);
        $newExpectedEnd = $oldExpectedEnd + ($approvedMin * 60);
        updateOne(collection('break_sessions'), ['_id' => $session['_id']], [
            'expected_end_at' => date('Y-m-d H:i:s', $newExpectedEnd),
            'extension_minutes' => (int)($session['extension_minutes'] ?? 0) + $approvedMin,
            'extension_reason' => (string)($req['reason'] ?? 'Approved extension'),
            'extended_by' => $user['id'],
            'extended_at' => date('Y-m-d H:i:s'),
            'status' => 'extended',
            'updated_at' => date('Y-m-d H:i:s')
        ]);
    }

    updateOne(collection('break_requests'), ['_id' => mongoId($data['request_id'])], [
        'status' => 'approved',
        'approved_minutes' => $approvedMin,
        'duration_minutes' => $approvedMin,
        'extend_minutes' => $breakType === 'manual' ? 0 : $approvedMin,
        'approved_by' => $user['id'],
        'approved_at' => date('Y-m-d H:i:s'),
    ]);

    $kind = $breakType === 'manual' ? 'manual break' : "{$breakType} break extension";
    notifyEmployee(
        (string)$req['employee_id'],
        ucfirst($kind) . ' Approved',
        'Your break request has been approved.',
        'success',
        [
            'event_id' => 'break_request:' . (string)$req['_id'] . ':approved:' . (string)$req['employee_id'],
            'event_type' => $breakType === 'manual' ? 'manual_break_request.approved' : $breakType . '_extension_request.approved',
            'source_employee_id' => (string)$req['employee_id'],
            'source_request_id' => (string)$req['_id'],
            'speak_text' => 'Your break request has been approved.',
        ]
    );
    ok(null, ucfirst($kind) . ' request approved.');
}

if (method() === 'POST' && ($_GET['action'] ?? '') === 'approve_all_breaks') {
    if ($user['role'] !== 'hr') fail('Forbidden.', 403);
    $data = input();
    $defaultMinutes = isset($data['approved_minutes']) ? (int)$data['approved_minutes'] : null;
    if ($defaultMinutes !== null && !in_array($defaultMinutes, allowedBreakMinutes(), true)) {
        fail('Invalid approved duration.', 422);
    }

    $pending = findMany(collection('break_requests'), ['status' => 'pending'], ['sort' => ['created_at' => 1]]);
    $approved = 0;
    foreach ($pending as $req) {
        if (in_array($req['request_type'] ?? '', ['checkout_undo', 'meeting'], true)) continue;
        $att = findOne(collection('attendance'), ['employee_id' => $req['employee_id'], 'date' => $req['date']]);
        if (!$att || !empty($att['check_out'])) continue;

        $breakType = normaliseBreakType($req);
        $minutes = $defaultMinutes ?? (int)($req['requested_minutes'] ?? 30);
        if (!in_array($minutes, allowedBreakMinutes(), true)) $minutes = 30;

        if ($breakType === 'manual') {
            $session = startBreakSessionForAttendance($att, (string)$req['employee_id'], 'manual', $minutes, time());
            if (!$session) continue;

            $att = transitionActivity($att, 'break', time());
            $att['break_start_time'] = date('H:i:s');
            $att = syncLegacyFields($att, time());
            updateOne(collection('attendance'), ['_id' => $att['_id']], $att);
        } else {
            $session = findOne(collection('break_sessions'), [
                'employee_id' => (string)$req['employee_id'],
                'attendance_id' => (string)$att['_id'],
                'break_type' => $breakType,
                'status' => ['$in' => ['active', 'extended']]
            ]);
            if (!$session) continue;
            $newExpectedEnd = strtotime((string)$session['expected_end_at']) + ($minutes * 60);
            updateOne(collection('break_sessions'), ['_id' => $session['_id']], [
                'expected_end_at' => date('Y-m-d H:i:s', $newExpectedEnd),
                'extension_minutes' => (int)($session['extension_minutes'] ?? 0) + $minutes,
                'extension_reason' => (string)($req['reason'] ?? 'Approved extension'),
                'extended_by' => $user['id'],
                'extended_at' => date('Y-m-d H:i:s'),
                'status' => 'extended',
                'updated_at' => date('Y-m-d H:i:s')
            ]);
        }

        updateOne(collection('break_requests'), ['_id' => $req['_id']], [
            'status' => 'approved',
            'approved_minutes' => $minutes,
            'duration_minutes' => $minutes,
            'extend_minutes' => $breakType === 'manual' ? 0 : $minutes,
            'approved_by' => $user['id'],
            'approved_at' => date('Y-m-d H:i:s'),
        ]);
        $approvedSpeak = $breakType === 'manual'
            ? "Your {$minutes} minute break request has been approved."
            : "Your {$breakType} extension has been approved for {$minutes} minutes.";
        notifyEmployee(
            (string)$req['employee_id'],
            'Break Request Approved',
            "HR approved your {$breakType} break request for {$minutes} minutes.",
            'success',
            [
                'event_id' => 'break_request:' . (string)$req['_id'] . ':approved:' . (string)$req['employee_id'],
                'event_type' => $breakType === 'manual' ? 'manual_break_request.approved' : $breakType . '_extension_request.approved',
                'source_id' => (string)$req['_id'],
                'speak_text' => $approvedSpeak,
            ]
        );
        $approved++;
    }

    ok(['approved' => $approved], "{$approved} break request(s) approved.");
}

/* ═══════════════════════════════════════════════════════════════════
   POST — reject break (HR)
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && ($_GET['action'] ?? '') === 'reject_break') {
    if ($user['role'] !== 'hr') fail('Forbidden.', 403);
    $data = input();
    require_fields($data, ['request_id']);

    $req = findOne(collection('break_requests'), ['_id' => mongoId($data['request_id']), 'status' => 'pending']);
    if (!$req) fail('Pending break request not found.', 404);

    if (($req['request_type'] ?? '') === 'late_return') {
        $att = findOne(collection('attendance'), ['employee_id' => $req['employee_id'], 'date' => $req['date']]);
        if ($att) {
            $lateMins = (int)($req['requested_minutes'] ?? 0);
            $newLateMin = (int)($att['late_minutes'] ?? 0) + $lateMins;
            $newStatus = $att['status'] ?? 'present';
            if ($newStatus === 'present') {
                $newStatus = 'late';
            }

            $updateFields = [
                'late_minutes' => $newLateMin,
                'status' => $newStatus,
            ];
            if (($req['break_type'] ?? '') === 'lunch') {
                $updateFields['lunch_late_minutes'] = (int)($att['lunch_late_minutes'] ?? 0) + $lateMins;
            } elseif (($req['break_type'] ?? '') === 'evening') {
                $updateFields['evening_late_minutes'] = (int)($att['evening_late_minutes'] ?? 0) + $lateMins;
            }

            updateOne(collection('attendance'), ['_id' => $att['_id']], $updateFields);
        }

        updateOne(collection('break_requests'), ['_id' => $req['_id']], [
            'status' => 'rejected',
            'rejected_by' => $user['id'],
            'rejected_at' => date('Y-m-d H:i:s')
        ]);

        notifyEmployee(
            (string)$req['employee_id'],
            'Late Break Return Rejected',
            'Your break request has been rejected.',
            'error',
            [
                'event_id' => 'late_return_rejected:' . (string)$req['_id'] . ':rejected:' . (string)$req['employee_id'],
                'event_type' => 'late_return.rejected',
                'source_employee_id' => (string)$req['employee_id'],
                'source_request_id' => (string)$req['_id'],
                'speak_text' => 'Your break request has been rejected.',
            ]
        );
        ok(null, 'Late break return rejected.');
    }

    updateOne(collection('break_requests'), ['_id' => mongoId($data['request_id'])], [
        'status' => 'rejected',
        'rejected_by' => $user['id'],
        'rejected_at' => date('Y-m-d H:i:s')
    ]);
    $kind = ($req['request_type'] ?? '') === 'checkout_undo' ? 'check-out undo' : (normaliseBreakType($req) . ' break');
    $breakType = normaliseBreakType($req);
    $isCheckoutUndo = ($req['request_type'] ?? '') === 'checkout_undo';
    $msgText = $isCheckoutUndo ? 'Your request has been rejected.' : 'Your break request has been rejected.';
    notifyEmployee(
        (string)$req['employee_id'],
        ucfirst($kind) . ' Rejected',
        $msgText,
        'error',
        [
            'event_id' => ($isCheckoutUndo ? 'checkout_undo_request:' : 'break_request:') . (string)$req['_id'] . ':rejected:' . (string)$req['employee_id'],
            'event_type' => $isCheckoutUndo ? 'checkout_undo_request.rejected' : ($breakType === 'manual' ? 'manual_break_request.rejected' : $breakType . '_extension_request.rejected'),
            'source_employee_id' => (string)$req['employee_id'],
            'source_request_id' => (string)$req['_id'],
            'speak_text' => $msgText,
        ]
    );
    ok(null, ucfirst($kind) . ' request rejected.');
}

/* ═══════════════════════════════════════════════════════════════════
   POST — HR manual attendance record
══════════════════════════════════════════════════════════════════════ */
if (method() === 'POST' && !isset($_GET['action'])) {
    if ($user['role'] !== 'hr') fail('Forbidden.', 403);
    $data   = input();
    require_fields($data, ['employee_id', 'date', 'status']);
    $status = strtolower(trim((string)$data['status']));
    if (!in_array($status, allowedStatuses(), true)) fail('Invalid attendance status.', 422);

    $checkIn  = !empty($data['check_in'])      ? $data['check_in']      : null;
    $checkOut = !empty($data['check_out'])     ? $data['check_out']     : null;
    $lateMin  = !empty($data['late_minutes'])  ? (int)$data['late_minutes'] : 0;
    $workhrs  = !empty($data['working_hours']) ? $data['working_hours'] : null;
    $taskUpd  = array_key_exists('daily_task_update', $data) ? trim((string)$data['daily_task_update']) : null;

    if ($status === 'absent') { $checkIn = null; $checkOut = null; $lateMin = 0; $workhrs = null; }

    try {
        upsertOne(collection('attendance'), [
            'employee_id' => (string)$data['employee_id'],
            'date'        => $data['date'],
        ], [
            'employee_id'         => (string)$data['employee_id'],
            'date'                => $data['date'],
            'check_in'            => $checkIn,
            'check_out'           => $checkOut,
            'status'              => $status,
            'late_minutes'        => $lateMin,
            'working_hours'       => $workhrs,
            'daily_task_update'   => $taskUpd !== '' ? $taskUpd : null,
            'total_break_seconds' => 0,
            'created_at'          => date('Y-m-d H:i:s'),
        ]);
    } catch (Exception $e) {
        fail('Failed to save attendance record.', 500);
    }

    ok(null, 'Attendance record saved.');
}

fail('Method not allowed.', 405);
