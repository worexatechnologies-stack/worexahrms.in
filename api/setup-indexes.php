<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

$results = [];

// Helper to create index with try-catch
function tryCreateIndex(string $collection, array $keys, array $options = []) {
    global $results;
    try {
        collection($collection)->createIndex($keys, $options);
        $results[] = "OK: index on $collection (" . json_encode($keys) . ")";
    } catch (Exception $e) {
        $results[] = "SKIPPED/EXISTS: $collection (" . json_encode($keys) . "): " . $e->getMessage();
    }
}

// ─── Safe duplicate-active-session cleanup migration ─────────────────────────
// Finds employees with multiple attendance records that have no check_out.
// Keeps the most recent (highest clock_in_at / _id), closes the rest safely.
function migrateDuplicateActiveSessions(): array {
    $logs = [];
    $col = collection('attendance');

    // Fetch all open records
    $openRecs = findMany($col, [
        'check_in' => ['$ne' => null],
        'check_out' => null,
    ]);

    // Group by employee_id
    $byEmp = [];
    foreach ($openRecs as $r) {
        $eid = (string)($r['employee_id'] ?? '');
        if (!$eid) continue;
        $byEmp[$eid][] = $r;
    }

    foreach ($byEmp as $eid => $recs) {
        if (count($recs) <= 1) continue;

        // Sort descending by check_in time or _id
        usort($recs, function ($a, $b) {
            $ta = strtotime($a['clock_in_at'] ?? $a['check_in'] ?? '1970-01-01');
            $tb = strtotime($b['clock_in_at'] ?? $b['check_in'] ?? '1970-01-01');
            return $tb <=> $ta;
        });

        $keep = $recs[0];
        $logs[] = "KEEP: emp=$eid id=" . (string)$keep['_id'];

        for ($i = 1; $i < count($recs); $i++) {
            $dup = $recs[$i];
            $dupDate = $dup['date'] ?? date('Y-m-d');
            $logs[] = "CLOSE DUPLICATE: emp=$eid id=" . (string)$dup['_id'] . " date=$dupDate";

            // Close any open break sessions on this duplicate
            $bsCol = collection('break_sessions');
            $openBreaks = findMany($bsCol, [
                'attendance_id' => (string)$dup['_id'],
                'status' => ['$in' => ['active', 'extended']],
            ]);
            foreach ($openBreaks as $b) {
                updateOne($bsCol, ['_id' => $b['_id']], [
                    'ended_at'   => $dupDate . ' 21:30:00',
                    'status'     => 'completed',
                    'updated_at' => date('Y-m-d H:i:s'),
                ]);
                $logs[] = "  Closed break session " . (string)$b['_id'];
            }

            // Mark attendance record as checked out
            updateOne($col, ['_id' => $dup['_id']], [
                'check_out'              => '21:30:00',
                'checkout_at'            => $dupDate . ' 21:30:00',
                'is_checked_out'         => true,
                'active_activity_type'   => 'working',
                'session_status'         => 'CHECKED_OUT',
                'current_state'          => 'CHECKED_OUT',
                'updated_at'             => date('Y-m-d H:i:s'),
            ]);
        }
    }
    return $logs;
}

try {
    $migrationLogs = migrateDuplicateActiveSessions();
    $results = array_merge($results, $migrationLogs);

    // Partial unique index: one ACTIVE session per employee at a time
    // MongoDB partial filter supports: $eq, $gt, $gte, $lt, $lte, $type, $exists, and logical operators.
    // We use: is_checked_out == false AND check_out doesn't exist (or is null via $type)
    try {
        collection('attendance')->createIndex(
            ['employee_id' => 1],
            [
                'unique' => true,
                'name'   => 'unique_active_attendance_per_employee',
                'partialFilterExpression' => [
                    'is_checked_out' => false,
                ]
            ]
        );
        $results[] = "OK: unique_active_attendance_per_employee";
    } catch (Exception $e) {
        $results[] = "SKIPPED/EXISTS unique_active_attendance_per_employee: " . $e->getMessage();
    }

    // Attendance lookup indexes
    tryCreateIndex('attendance', ['employee_id' => 1, 'date' => -1]);
    tryCreateIndex('attendance', ['employee_id' => 1, 'clock_in_at' => -1]);
    tryCreateIndex('attendance', ['date' => -1, 'status' => 1]);
    tryCreateIndex('attendance', ['is_checked_out' => 1]);
    tryCreateIndex('attendance', ['active_activity_type' => 1]);

    // Break session indexes
    tryCreateIndex('break_sessions', ['employee_id' => 1, 'attendance_id' => 1, 'status' => 1]);
    tryCreateIndex('break_requests', ['status' => 1, 'created_at' => -1]);

    // Notification indexes
    tryCreateIndex('notifications', ['user_id' => 1, 'is_read' => 1, 'created_at' => -1]);
    tryCreateIndex('notifications', ['user_id' => 1, 'role' => 1, 'is_read' => 1, 'created_at' => -1]);
    tryCreateIndex('notifications', ['event_id' => 1], ['unique' => true, 'sparse' => true]);
    tryCreateIndex('notifications', ['user_id' => 1, 'role' => 1, 'event_id' => 1, '_id' => 1]);

    // Other collections
    tryCreateIndex('employees', ['employee_code' => 1], ['sparse' => true]);
    tryCreateIndex('leaves', ['employee_id' => 1, 'status' => 1, 'created_at' => -1]);
    tryCreateIndex('wfh', ['employee_id' => 1, 'status' => 1, 'created_at' => -1]);
    tryCreateIndex('wfh_status_updates', ['employee_id' => 1, 'created_at' => -1]);
    tryCreateIndex('wfh_status_updates', ['date' => 1]);

    echo json_encode(['success' => true, 'details' => $results]);
} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => 'Index script failed: ' . $e->getMessage()]);
}
