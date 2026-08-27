<?php
declare(strict_types=1);
/**
 * AttendanceService.php
 *
 * Single source of truth for attendance session calculation.
 * Both attendance.php and dashboard.php MUST use these functions.
 * Never duplicate timer logic in individual endpoints or React components.
 */

// ─── State Constants ──────────────────────────────────────────────────────────
// Session-level status
const SESSION_ACTIVE       = 'ACTIVE';
const SESSION_CHECKED_OUT  = 'CHECKED_OUT';

// Activity-level states (current_state / active_activity_type)
const STATE_WORKING  = 'working';
const STATE_MEETING  = 'meeting';
const STATE_BREAK    = 'break';
const STATE_LUNCH    = 'lunch';
const STATE_DONE     = 'CHECKED_OUT';

// Valid forward transitions
const ALLOWED_TRANSITIONS = [
    STATE_WORKING => [STATE_MEETING, STATE_BREAK, STATE_LUNCH, STATE_DONE],
    STATE_MEETING => [STATE_WORKING, STATE_DONE],
    STATE_BREAK   => [STATE_WORKING, STATE_DONE],
    STATE_LUNCH   => [STATE_WORKING, STATE_DONE],
    STATE_DONE    => [], // No transitions from checked-out
];

// Allowed break activity starts from WORKING
const STARTABLE_ACTIVITIES = [STATE_MEETING, STATE_BREAK, STATE_LUNCH];

// ─── Default required working hours ─────────────────────────────────────────
function defaultRequiredWorkSeconds(): int {
    return 28800; // 8 hours
}

// ─── Validate state transition ───────────────────────────────────────────────
function validateStateTransition(string $from, string $to): void {
    $allowed = ALLOWED_TRANSITIONS[$from] ?? [];
    if (!in_array($to, $allowed, true)) {
        $msg = match(true) {
            $from === STATE_DONE         => 'This session has already been checked out.',
            $from === $to               => 'You are already in this state.',
            $from === STATE_MEETING && $to === STATE_BREAK  => 'End the current meeting before starting a break.',
            $from === STATE_MEETING && $to === STATE_LUNCH  => 'End the current meeting before starting lunch.',
            $from === STATE_BREAK   && $to === STATE_MEETING => 'End the current break before starting a meeting.',
            $from === STATE_BREAK   && $to === STATE_LUNCH  => 'End the current break before starting lunch.',
            $from === STATE_LUNCH   && $to === STATE_MEETING => 'End lunch before starting a meeting.',
            $from === STATE_LUNCH   && $to === STATE_BREAK  => 'End lunch before starting another break.',
            default => "Invalid state transition from '$from' to '$to'.",
        };
        fail($msg, 409);
    }
}

// ─── Server UTC now ──────────────────────────────────────────────────────────
// All timestamps stored in DB use Asia/Kolkata (IST = UTC+5:30) per this app's convention.
// We use time() which returns Unix timestamp (UTC). We format in IST.
function nowIST(): int {
    return time();
}

function nowISTString(): string {
    return date('Y-m-d H:i:s'); // IST because timezone is set at top of files
}

// ─── Get the canonical current session ───────────────────────────────────────
function getActiveSession(string $empId): ?array {
    $today = date('Y-m-d');
    $rec = findOne(collection('attendance'), [
        'employee_id' => $empId,
        'date'        => $today,
        'check_in'    => ['$ne' => null],
        'check_out'   => null,
    ]);
    return $rec ?: null;
}

// ─── Calculate all live duration values from server timestamps ───────────────
// This is the SINGLE function that computes durations. Never duplicate elsewhere.
function calcLiveDurations(array $rec): array {
    $now = nowIST();

    $isCheckedOut = !empty($rec['is_checked_out']) || !empty($rec['check_out']);

    // Determine the current activity
    $activeType = $rec['active_activity_type'] ?? STATE_WORKING;

    // Delta since last activity started
    $lastResumedTs = strtotime($rec['last_resumed_at'] ?? $rec['clock_in_at'] ?? date('Y-m-d H:i:s', $now));
    $delta = $isCheckedOut ? 0 : max(0, $now - $lastResumedTs);

    // Start from accumulated DB values
    $workSecs     = (int)($rec['accumulated_work_seconds'] ?? 0);
    $meetingSecs  = (int)($rec['accumulated_meeting_seconds'] ?? 0);
    $lunchSecs    = (int)($rec['accumulated_lunch_seconds'] ?? 0);
    $breakSecs    = (int)($rec['accumulated_break_seconds'] ?? 0);
    $extendedSecs = (int)($rec['accumulated_extended_break_seconds'] ?? 0);
    $wfhSecs      = (int)($rec['wfh_working_seconds'] ?? 0);
    $officeSecs   = (int)($rec['office_working_seconds'] ?? 0);

    // Add live delta to the appropriate bucket
    if (!$isCheckedOut) {
        if ($activeType === STATE_WORKING) {
            $workSecs += $delta;
            if (($rec['work_mode'] ?? 'office') === 'wfh') {
                $wfhSecs += $delta;
            } else {
                $officeSecs += $delta;
            }
        } elseif ($activeType === STATE_MEETING) {
            $meetingSecs += $delta;
            // Meeting time counts as productive time and contributes to location bucket
            if (($rec['work_mode'] ?? 'office') === 'wfh') {
                $wfhSecs += $delta;
            } else {
                $officeSecs += $delta;
            }
        } elseif ($activeType === STATE_LUNCH) {
            $lunchSecs += $delta;
        } elseif ($activeType === STATE_BREAK) {
            $breakSecs += $delta;
        }
    }

    // Required hours from record (populated at check-in from settings)
    $requiredSecs = (int)($rec['required_work_seconds'] ?? defaultRequiredWorkSeconds());

    // Net productive = work + meeting (meetings count as work per policy)
    $productiveSecs = $workSecs + $meetingSecs;

    // Gross session = time from clock-in to now (or checkout)
    $clockInTs = strtotime($rec['clock_in_at'] ?? ($rec['date'] . ' ' . $rec['check_in']));
    if ($isCheckedOut && !empty($rec['checkout_at'])) {
        $endTs = strtotime($rec['checkout_at']);
    } elseif ($isCheckedOut && !empty($rec['check_out'])) {
        $endTs = strtotime($rec['date'] . ' ' . $rec['check_out']);
    } else {
        $endTs = $now;
    }
    $grossSecs = max(0, $endTs - $clockInTs);

    $remainingSecs = max(0, $requiredSecs - $productiveSecs);
    $overtimeSecs  = max(0, $productiveSecs - $requiredSecs);

    return [
        'server_now'                    => $now,
        'server_now_str'                => date('Y-m-d H:i:s', $now),
        'active_activity_type'          => $activeType,
        'last_resumed_at'               => $rec['last_resumed_at'] ?? null,
        'work_mode'                     => $rec['work_mode'] ?? 'office',
        'live_work_seconds'             => $workSecs,
        'live_meeting_seconds'          => $meetingSecs,
        'live_lunch_seconds'            => $lunchSecs,
        'live_break_seconds'            => $breakSecs,
        'live_extended_break_seconds'   => $extendedSecs,
        'live_wfh_working_seconds'      => $wfhSecs,
        'live_office_working_seconds'   => $officeSecs,
        'live_productive_working_seconds' => $productiveSecs,
        'live_gross_session_seconds'    => $grossSecs,
        'live_remaining_seconds'        => $remainingSecs,
        'live_overtime_seconds'         => $overtimeSecs,
        'required_work_seconds'         => $requiredSecs,
        'is_checked_out'                => $isCheckedOut,
    ];
}

// ─── Merge live durations into attendance record ─────────────────────────────
function enrichWithLiveDurations(array $rec): array {
    $live = calcLiveDurations($rec);
    return array_merge($rec, $live);
}

// ─── Transition to a new activity state ─────────────────────────────────────
function transitionActivityState(array $rec, string $newType, int $nowTs): array {
    if (!empty($rec['is_checked_out'])) {
        return $rec; // Guard: cannot transition checked-out session
    }

    $lastResumedTs = strtotime($rec['last_resumed_at'] ?? $rec['clock_in_at'] ?? date('Y-m-d H:i:s', $nowTs));
    $delta = max(0, $nowTs - $lastResumedTs);

    $activeType = $rec['active_activity_type'] ?? STATE_WORKING;

    // Accumulate the elapsed time for the OLD activity
    if ($activeType === STATE_WORKING) {
        $rec['accumulated_work_seconds'] = (int)($rec['accumulated_work_seconds'] ?? 0) + $delta;
        if (($rec['work_mode'] ?? 'office') === 'wfh') {
            $rec['wfh_working_seconds'] = (int)($rec['wfh_working_seconds'] ?? 0) + $delta;
        } else {
            $rec['office_working_seconds'] = (int)($rec['office_working_seconds'] ?? 0) + $delta;
        }
    } elseif ($activeType === STATE_MEETING) {
        $rec['accumulated_meeting_seconds'] = (int)($rec['accumulated_meeting_seconds'] ?? 0) + $delta;
        if (($rec['work_mode'] ?? 'office') === 'wfh') {
            $rec['wfh_working_seconds'] = (int)($rec['wfh_working_seconds'] ?? 0) + $delta;
        } else {
            $rec['office_working_seconds'] = (int)($rec['office_working_seconds'] ?? 0) + $delta;
        }
    } elseif ($activeType === STATE_LUNCH) {
        $rec['accumulated_lunch_seconds'] = (int)($rec['accumulated_lunch_seconds'] ?? 0) + $delta;
    } elseif ($activeType === STATE_BREAK) {
        $rec['accumulated_break_seconds'] = (int)($rec['accumulated_break_seconds'] ?? 0) + $delta;
    }

    // Switch to the new activity
    $rec['active_activity_type'] = $newType;
    $rec['last_resumed_at']      = date('Y-m-d H:i:s', $nowTs);
    $rec['updated_at']           = date('Y-m-d H:i:s', $nowTs);

    // Clear legacy pause flags
    $rec['is_paused']         = false;
    $rec['hr_timer_paused']   = false;
    $rec['paused_at']         = null;
    $rec['pause_reason']      = null;
    $rec['hr_pause_reason']   = null;
    $rec['hr_pause_by']       = null;
    $rec['hr_pause_by_name']  = null;
    $rec['hr_pause_started_at'] = null;
    if ($newType === STATE_WORKING) {
        $rec['break_start_time'] = null;
    }

    return $rec;
}

// ─── Build the normalized session response ───────────────────────────────────
// This is what both dashboard.php and attendance.php return to the frontend.
function buildSessionResponse(array $rec): array {
    $live = calcLiveDurations($rec);

    $mode = $rec['work_mode'] ?? $rec['mode'] ?? 'office';
    $state = $rec['active_activity_type'] ?? STATE_WORKING;
    $isOut = !empty($rec['is_checked_out']) || !empty($rec['check_out']);
    if ($isOut) $state = STATE_DONE;

    $cfg = [
        'checkin_open'         => '09:00',
        'late_after'           => '09:45',
        'checkin_close'        => '10:00',
        'checkout_open'        => '18:30',
        'checkout_close'       => '19:00',
        'lunch_start'          => '13:30',
        'lunch_end'            => '14:30',
        'lunch_duration_min'   => 60,
        'evening_start'        => '16:30',
        'evening_end'          => '17:00',
        'evening_duration_min' => 30,
    ];

    return [
        'id'                     => (string)$rec['_id'],
        'employee_id'            => $rec['employee_id'],
        'date'                   => $rec['date'] ?? $rec['work_date'] ?? null,
        'work_mode'              => $mode,
        'mode'                   => $mode,
        'session_status'         => $isOut ? SESSION_CHECKED_OUT : SESSION_ACTIVE,
        'current_state'          => $state,
        'active_activity_type'   => $state,
        'check_in'               => $rec['check_in'] ?? null,
        'check_out'              => $rec['check_out'] ?? null,
        'clock_in_at'            => $rec['clock_in_at'] ?? null,
        'checkout_at'            => $rec['checkout_at'] ?? null,
        'last_resumed_at'        => $rec['last_resumed_at'] ?? null,
        'status'                 => $rec['status'] ?? 'present',
        'late_minutes'           => (int)($rec['late_minutes'] ?? 0),
        'daily_task_update'      => $rec['daily_task_update'] ?? null,

        // Live timer values (calculated from server timestamps)
        'server_now'                      => $live['server_now'],
        'server_now_str'                  => $live['server_now_str'],
        'accumulated_work_seconds'        => (int)($rec['accumulated_work_seconds'] ?? 0),
        'accumulated_meeting_seconds'     => (int)($rec['accumulated_meeting_seconds'] ?? 0),
        'accumulated_lunch_seconds'       => (int)($rec['accumulated_lunch_seconds'] ?? 0),
        'accumulated_break_seconds'       => (int)($rec['accumulated_break_seconds'] ?? 0),
        'accumulated_extended_break_seconds' => (int)($rec['accumulated_extended_break_seconds'] ?? 0),
        'wfh_working_seconds'             => (int)($rec['wfh_working_seconds'] ?? 0),
        'office_working_seconds'          => (int)($rec['office_working_seconds'] ?? 0),
        'live_work_seconds'               => $live['live_work_seconds'],
        'live_meeting_seconds'            => $live['live_meeting_seconds'],
        'live_lunch_seconds'              => $live['live_lunch_seconds'],
        'live_break_seconds'              => $live['live_break_seconds'],
        'live_extended_break_seconds'     => $live['live_extended_break_seconds'],
        'live_wfh_working_seconds'        => $live['live_wfh_working_seconds'],
        'live_office_working_seconds'     => $live['live_office_working_seconds'],
        'live_productive_working_seconds' => $live['live_productive_working_seconds'],
        'live_gross_session_seconds'      => $live['live_gross_session_seconds'],
        'live_remaining_seconds'          => $live['live_remaining_seconds'],
        'live_overtime_seconds'           => $live['live_overtime_seconds'],
        'required_work_seconds'           => $live['required_work_seconds'],
        'overtime_seconds'                => isset($rec['overtime_seconds']) ? (int)$rec['overtime_seconds'] : (int)$live['live_overtime_seconds'],
        'overtime_hours'                  => $rec['overtime_hours'] ?? formatHMS($live['live_overtime_seconds']),

        // Legacy compatibility
        'worked_seconds'         => $live['live_productive_working_seconds'],
        'net_working_hours'      => formatHMS($live['live_productive_working_seconds']),
        'working_hours'          => formatHMS($live['live_productive_working_seconds']),
        'total_break_seconds'    => $live['live_lunch_seconds'] + $live['live_break_seconds'],

        // Meeting / break flags
        'is_paused'              => ($state === STATE_MEETING || $state === STATE_BREAK || $state === STATE_LUNCH),
        'break_start_time'       => ($state === STATE_BREAK || $state === STATE_LUNCH) ? ($rec['break_start_time'] ?? null) : null,
        'is_checked_out'         => $isOut,

        // Checkin metadata
        'checkin_lat'            => $rec['checkin_lat'] ?? null,
        'checkin_lng'            => $rec['checkin_lng'] ?? null,
        'checkin_accuracy'       => $rec['checkin_accuracy'] ?? null,
        'checkin_device'         => $rec['checkin_device'] ?? null,
        'wfh_request_id'         => $rec['wfh_request_id'] ?? null,

        // Attendance settings (injected for frontend convenience)
        'attendance_settings'    => $cfg,
    ];
}

function formatHMS(int $secs): string {
    $secs = max(0, $secs);
    return sprintf('%02d:%02d:%02d', (int)floor($secs/3600), (int)floor(($secs%3600)/60), $secs%60);
}

// ─── Finalize checkout ────────────────────────────────────────────────────────
function finalizeCheckout(array $rec, int $nowTs): array {
    // Auto-close any active activity
    $activeType = $rec['active_activity_type'] ?? STATE_WORKING;

    // Accumulate last interval
    $lastResumedTs = strtotime($rec['last_resumed_at'] ?? $rec['clock_in_at'] ?? date('Y-m-d H:i:s', $nowTs));
    $delta = max(0, $nowTs - $lastResumedTs);

    if ($activeType === STATE_WORKING) {
        $rec['accumulated_work_seconds'] = (int)($rec['accumulated_work_seconds'] ?? 0) + $delta;
        if (($rec['work_mode'] ?? 'office') === 'wfh') {
            $rec['wfh_working_seconds'] = (int)($rec['wfh_working_seconds'] ?? 0) + $delta;
        } else {
            $rec['office_working_seconds'] = (int)($rec['office_working_seconds'] ?? 0) + $delta;
        }
    } elseif ($activeType === STATE_MEETING) {
        $rec['accumulated_meeting_seconds'] = (int)($rec['accumulated_meeting_seconds'] ?? 0) + $delta;
        if (($rec['work_mode'] ?? 'office') === 'wfh') {
            $rec['wfh_working_seconds'] = (int)($rec['wfh_working_seconds'] ?? 0) + $delta;
        } else {
            $rec['office_working_seconds'] = (int)($rec['office_working_seconds'] ?? 0) + $delta;
        }
    } elseif ($activeType === STATE_LUNCH) {
        $rec['accumulated_lunch_seconds'] = (int)($rec['accumulated_lunch_seconds'] ?? 0) + $delta;
    } elseif ($activeType === STATE_BREAK) {
        $rec['accumulated_break_seconds'] = (int)($rec['accumulated_break_seconds'] ?? 0) + $delta;
    }

    $checkoutStr = date('H:i:s', $nowTs);
    $checkoutDateTime = date('Y-m-d H:i:s', $nowTs);

    $productiveSecs = (int)($rec['accumulated_work_seconds'] ?? 0) + (int)($rec['accumulated_meeting_seconds'] ?? 0);
    $totalBreak     = (int)($rec['accumulated_break_seconds'] ?? 0) + (int)($rec['accumulated_lunch_seconds'] ?? 0);

    $rec['check_out']              = $checkoutStr;
    $rec['checkout_at']            = $checkoutDateTime;
    $rec['is_checked_out']         = true;
    $rec['active_activity_type']   = STATE_DONE;
    $rec['last_resumed_at']        = $checkoutDateTime;
    $rec['updated_at']             = $checkoutDateTime;
    $rec['worked_seconds']         = $productiveSecs;
    $rec['net_working_hours']      = formatHMS($productiveSecs);
    $rec['working_hours']          = formatHMS($productiveSecs);
    $rec['total_break_seconds']    = $totalBreak;
    
    // Save overtime record
    $requiredSecs                  = (int)($rec['required_work_seconds'] ?? 28800);
    $overtimeSecs                  = max(0, $productiveSecs - $requiredSecs);
    $rec['overtime_seconds']       = $overtimeSecs;
    $rec['overtime_hours']         = formatHMS($overtimeSecs);

    // Clear pause flags
    $rec['is_paused']              = false;
    $rec['break_start_time']       = null;
    $rec['hr_timer_paused']        = false;

    return $rec;
}
