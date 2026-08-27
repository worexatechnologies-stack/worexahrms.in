<?php
/**
 * MongoDB Query Helpers
 * Functions to make MongoDB queries easier and more consistent
 */

declare(strict_types=1);

/**
 * Convert MongoDB ObjectId to string
 */
function mongoId(string $id): MongoDB\BSON\ObjectId
{
    if ($id instanceof MongoDB\BSON\ObjectId) {
        return $id;
    }
    try {
        return new MongoDB\BSON\ObjectId($id);
    } catch (Exception $e) {
        throw new Exception("Invalid ID: $id");
    }
}

/**
 * Sanitize MongoDB query filter
 */
function sanitizeFilter(array $filter): array
{
    // Operators allowed inside value objects (comparison / array operators)
    static $ALLOWED_OPS = [
        '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
        '$in', '$nin', '$exists', '$type',
        '$regex', '$options',              // text search
        '$ne', '$not',                     // negation
    ];

    $safe = [];
    foreach ($filter as $key => $value) {
        // Strip top-level keys that are operators (e.g. $where, $expr, $function)
        if (!is_string($key) || str_starts_with($key, '$')) {
            // Allow safe top-level operators ($or, $and, $nor)
            if (in_array($key, ['$or', '$and', '$nor'], true) && is_array($value)) {
                $safe[$key] = array_map(
                    fn($clause) => is_array($clause) ? sanitizeFilter($clause) : [],
                    $value
                );
            }
            continue;
        }

        if (is_array($value)) {
            // Only allow whitelisted operators inside value arrays
            $cleanedValue = [];
            foreach ($value as $vk => $vv) {
                if (is_string($vk) && str_starts_with($vk, '$')) {
                    if (!in_array($vk, $ALLOWED_OPS, true)) {
                        continue; // Drop dangerous ops: $where, $expr, $function, $accumulator etc.
                    }
                }
                $cleanedValue[$vk] = $vv;
            }
            $safe[$key] = $cleanedValue;
        } else {
            $safe[$key] = $value;
        }
    }
    return $safe;
}

/**
 * Find one document with error handling
 */
function findOne(MongoDB\Collection $collection, array $filter = []): array|null
{
    try {
        $doc = $collection->findOne(sanitizeFilter($filter));
        return $doc ? (array)$doc : null;
    } catch (Exception $e) {
        throw new Exception("Query failed: " . $e->getMessage());
    }
}

/**
 * Find multiple documents
 */
function findMany(MongoDB\Collection $collection, array $filter = [], array $options = []): array
{
    try {
        $cursor = $collection->find(sanitizeFilter($filter), $options);
        $results = [];
        foreach ($cursor as $doc) {
            $results[] = (array)$doc;
        }
        return $results;
    } catch (Exception $e) {
        throw new Exception("Query failed: " . $e->getMessage());
    }
}

/**
 * Returns true if an exception is a MongoDB duplicate key error (E11000).
 * Use this to give clean user-facing messages when unique indexes are violated.
 */
function isDuplicateKeyError(Throwable $e): bool
{
    return $e instanceof MongoDB\Driver\Exception\BulkWriteException
        && str_contains($e->getMessage(), 'E11000');
}

/**
 * Insert one document.
 * Throws a plain Exception with code 409 on duplicate key so callers
 * can do: if ($e->getCode() === 409) fail('Already exists.', 409);
 */
function insertOne(MongoDB\Collection $collection, array $data): array
{
    try {
        $result = $collection->insertOne($data);
        $data['_id'] = $result->getInsertedId();
        return $data;
    } catch (MongoDB\Driver\Exception\BulkWriteException $e) {
        if (isDuplicateKeyError($e)) {
            throw new Exception('duplicate_key', 409);
        }
        throw new Exception('Insert failed: ' . $e->getMessage());
    } catch (Exception $e) {
        throw new Exception('Insert failed: ' . $e->getMessage());
    }
}

/**
 * Update or insert (upsert) a document.
 */
function upsertOne(MongoDB\Collection $collection, array $filter, array $data): void
{
    try {
        $collection->updateOne(
            sanitizeFilter($filter),
            ['$set' => $data],
            ['upsert' => true]
        );
    } catch (Exception $e) {
        throw new Exception('Upsert failed: ' . $e->getMessage());
    }
}

/**
 * Update one document
 */
function updateOne(MongoDB\Collection $collection, array $filter, array $data): int
{
    try {
        $result = $collection->updateOne(
            sanitizeFilter($filter),
            ['$set' => $data]
        );
        return $result->getModifiedCount();
    } catch (Exception $e) {
        throw new Exception("Update failed: " . $e->getMessage());
    }
}

/**
 * Delete one document
 */
function deleteOne(MongoDB\Collection $collection, array $filter): int
{
    try {
        $result = $collection->deleteOne(sanitizeFilter($filter));
        return $result->getDeletedCount();
    } catch (Exception $e) {
        throw new Exception("Delete failed: " . $e->getMessage());
    }
}

/**
 * Delete multiple documents
 */
function deleteMany(MongoDB\Collection $collection, array $filter): int
{
    try {
        $result = $collection->deleteMany(sanitizeFilter($filter));
        return $result->getDeletedCount();
    } catch (Exception $e) {
        throw new Exception("Delete failed: " . $e->getMessage());
    }
}

/**
 * Count documents
 */
function countDocs(MongoDB\Collection $collection, array $filter = []): int
{
    try {
        return $collection->countDocuments(sanitizeFilter($filter));
    } catch (Exception $e) {
        throw new Exception("Count failed: " . $e->getMessage());
    }
}

/**
 * Aggregate with pipeline
 */
function aggregate(MongoDB\Collection $collection, array $pipeline): array
{
    try {
        $cursor = $collection->aggregate($pipeline);
        $results = [];
        foreach ($cursor as $doc) {
            $results[] = (array)$doc;
        }
        return $results;
    } catch (Exception $e) {
        throw new Exception("Aggregation failed: " . $e->getMessage());
    }
}

/**
 * Format notification for JSON responses. Converts MongoDB UTCDateTime to string.
 */
function formatNotification(array $notif): array
{
    $notif['id'] = (string)$notif['_id'];
    unset($notif['_id']); // prevent ObjectId JSON serialisation issues
    // Normalise created_at to string regardless of storage format
    if (isset($notif['created_at'])) {
        $notif['created_at'] = normalizeDateToString($notif['created_at']);
    }
    return $notif;
}

/**
 * Normalize a date value (UTCDateTime, $date array, or string) to a formatted string.
 */
function normalizeDateToString(mixed $val): string
{
    if ($val instanceof MongoDB\BSON\UTCDateTime) {
        return $val->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
    }
    if (is_array($val) && isset($val['$date'])) {
        try {
            $dt = new DateTime($val['$date']);
            return $dt->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
        } catch (Exception) {
            return '';
        }
    }
    if ($val instanceof DateTime) {
        return $val->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
    }
    if (is_object($val)) {
        return '';
    }
    return (string)($val ?? '');
}

function employeeDisplayName(string $employeeId): string {
    $emp = findOne(collection('employees'), ['_id' => mongoId($employeeId)]);
    return trim((string)($emp['name'] ?? 'Employee')) ?: 'Employee';
}

function cleanHrEmployeeMessage(string $employeeId, string $action): array {
    $name = employeeDisplayName($employeeId);
    $message = "{$name} {$action}.";
    return [$message, $message];
}

/**
 * Create one notification with event metadata for safe toast/TTS handling.
 */
function createNotification(
    string $userId,
    string $role,
    string $title,
    string $message,
    string $type = 'info',
    array $options = []
): void {
    $eventId = trim((string)($options['event_id'] ?? ''));
    if ($eventId === '') {
        $eventId = 'notification:' . bin2hex(random_bytes(8));
    }

    $doc = [
        'user_id'      => $userId,
        'recipient_id' => $userId,
        'role'         => $role,
        'title'        => $title,
        'message'      => $message,
        'type'         => $type,
        'event_id'     => $eventId,
        'event_type'   => (string)($options['event_type'] ?? 'notification'),
        'speak_text'   => (string)($options['speak_text'] ?? $message),
        'is_read'      => false,
        'created_at'   => new MongoDB\BSON\UTCDateTime(time() * 1000),
    ];

    // Structured fields
    if (!empty($options['source_employee_id'])) {
        $doc['source_employee_id'] = (string)$options['source_employee_id'];
        $doc['source_employee_name'] = employeeDisplayName((string)$options['source_employee_id']);
    }
    if (!empty($options['source_request_id'])) {
        $doc['source_request_id'] = (string)$options['source_request_id'];
    }

    // Copy any custom options as top-level fields (for check_in_time, lat, lng, device, accuracy, user_agent, etc.)
    foreach ($options as $k => $v) {
        if (!in_array($k, ['event_id', 'event_type', 'speak_text', 'source_employee_id', 'source_request_id'], true)) {
            $doc[$k] = $v;
        }
    }

    try {
        insertOne(collection('notifications'), $doc);
    } catch (Exception $e) {
        if ($e->getCode() !== 409) {
            throw $e;
        }
    }
}

/**
 * Shared notification helper to alert all HR users
 */
function dbNotifyHr(string $title, string $msg, string $type = 'info', array $options = []): void
{
    try {
        $hrs = findMany(collection('users'), ['role' => 'hr']);
        foreach ($hrs as $hr) {
            $hrOptions = $options;
            if (!empty($hrOptions['event_id'])) {
                $hrOptions['event_id'] = $hrOptions['event_id'] . ':hr:' . (string)$hr['_id'];
            }
            createNotification((string)$hr['_id'], 'hr', $title, $msg, $type, $hrOptions);
        }
    } catch (Exception $e) {}
}

/**
 * Shared cleaner to prevent checked-in attendance sessions from remaining open forever
 */
/**
 * Mark missed workday attendance after the configured absence cut-off.
 * Approved leave, holidays and weekly offs are never converted to absences.
 */
function markMissedAttendanceAbsent(): void
{
    date_default_timezone_set('Asia/Kolkata');
    $today = date('Y-m-d');

    try {
        $lastCheck = findOne(collection('settings'), ['key' => 'last_absence_check_date']);
        if (($lastCheck['value'] ?? '') === $today) {
            return;
        }

        $savedSettings = findOne(collection('settings'), ['key' => 'attendance_settings']);
        $settings = is_array($savedSettings['value'] ?? null) ? $savedSettings['value'] : [];
        $cutoff = (string)($settings['absence_mark_after'] ?? '13:00');
        if (time() < strtotime($today . ' ' . $cutoff . ':00')) return;

        $day = new DateTime($today);
        $dayOfWeek = (int)$day->format('N');
        if ($dayOfWeek === 7) return; // Sunday
        if ($dayOfWeek === 6) {
            $saturdayNumber = (int)ceil(((int)$day->format('j')) / 7);
            if ($saturdayNumber !== 3 && $saturdayNumber !== 4) return;
        }
        if (findOne(collection('holidays'), ['date' => $today])) return;

        $onLeave = findMany(collection('leaves'), [
            'status' => 'approved',
            'start_date' => ['$lte' => $today],
            'end_date' => ['$gte' => $today],
        ], ['projection' => ['employee_id' => 1]]);
        $leaveEmployeeIds = [];
        foreach ($onLeave as $leave) $leaveEmployeeIds[(string)($leave['employee_id'] ?? '')] = true;

        $employees = findMany(collection('employees'), [
            'status' => ['$regex' => '^active$', '$options' => 'i'],
        ], ['projection' => ['_id' => 1]]);
        foreach ($employees as $employee) {
            $employeeId = (string)$employee['_id'];
            if (isset($leaveEmployeeIds[$employeeId])) continue;
            if (findOne(collection('attendance'), ['employee_id' => $employeeId, 'date' => $today])) continue;

            upsertOne(collection('attendance'), ['employee_id' => $employeeId, 'date' => $today], [
                'employee_id' => $employeeId,
                'date' => $today,
                'status' => 'absent',
                'check_in' => null,
                'check_out' => null,
                'late_minutes' => 0,
                'working_hours' => null,
                'source' => 'automatic',
                'created_at' => date('Y-m-d H:i:s'),
            ]);
        }
        upsertOne(collection('settings'), ['key' => 'last_absence_check_date'], [
            'key' => 'last_absence_check_date',
            'value' => $today,
            'updated_at' => date('Y-m-d H:i:s'),
        ]);
    } catch (Exception $e) {
        // Attendance endpoints must remain available if the maintenance pass fails.
        error_log('Automatic absence marking failed: ' . $e->getMessage());
    }
}

function closeAllOpenSessions(): void
{
    date_default_timezone_set('Asia/Kolkata');
    markMissedAttendanceAbsent();
    $today = date('Y-m-d');
    $nowTs = time();
    $cutoffTs = strtotime($today . ' 21:30:00');

    try {
        // Find all attendance records where check_in is not null and check_out is null
        $openRecs = findMany(collection('attendance'), [
            'check_in' => ['$ne' => null],
            'check_out' => null
        ]);

        foreach ($openRecs as $rec) {
            $recDate = $rec['date'];
            $isPastCutoff = false;
            
            if ($recDate < $today) {
                $isPastCutoff = true;
            } elseif ($recDate === $today && $nowTs >= $cutoffTs) {
                $isPastCutoff = true;
            }

            if ($isPastCutoff) {
                $empId = $rec['employee_id'];
                $checkoutTime = '21:30:00';
                
                // Calculate total break seconds from break_sessions of this attendance record
                $activeBreaks = findMany(collection('break_sessions'), [
                    'attendance_id' => (string)$rec['_id']
                ]);
                
                $totalBreakSecs = 0;
                foreach ($activeBreaks as $b) {
                    if (!empty($b['ended_at'])) {
                        $totalBreakSecs += max(0, strtotime($b['ended_at']) - strtotime($b['started_at']));
                    } else {
                        // Active break at checkout cutoff
                        $breakStartTs = strtotime($b['started_at']);
                        $cutoffTimeTs = strtotime($recDate . ' 21:30:00');
                        $totalBreakSecs += max(0, $cutoffTimeTs - $breakStartTs);
                        
                        // Also close the active break session!
                        updateOne(collection('break_sessions'), ['_id' => $b['_id']], [
                            'ended_at' => $recDate . ' 21:30:00',
                            'status' => 'completed',
                            'updated_at' => date('Y-m-d H:i:s')
                        ]);
                    }
                }

                $checkinTs = strtotime($recDate . ' ' . $rec['check_in']);
                $checkoutTs = strtotime($recDate . ' ' . $checkoutTime);
                $netSecs = max(0, $checkoutTs - $checkinTs - $totalBreakSecs);
                $workingHours = sprintf('%02d:%02d', (int)floor($netSecs / 3600), (int)floor(($netSecs % 3600) / 60));

                updateOne(collection('attendance'), ['_id' => $rec['_id']], [
                    'check_out' => $checkoutTime,
                    'working_hours' => $workingHours,
                    'status' => 'requires_review', // Mark as requiring review
                    'break_start_time' => null,
                    'total_break_seconds' => $totalBreakSecs
                ]);

                // Notify HR
                $emp = findOne(collection('employees'), ['_id' => mongoId($empId)]);
                $empName = $emp['name'] ?? 'Unknown';

                // Check if notification already exists to avoid duplicates
                $existing = findOne(collection('notifications'), [
                    'role' => 'hr',
                    'source_employee_id' => $empId,
                    'event_type' => 'open_attendance_auto_closed',
                    'closed_date' => $recDate
                ]);

                if (!$existing) {
                    [$message, $speak] = cleanHrEmployeeMessage($empId, 'attendance was automatically closed for review');
                    dbNotifyHr(
                        'Attendance Technical Issue',
                        $message,
                        'warning',
                        [
                            'event_id' => "auto_close:{$empId}:{$recDate}:created",
                            'event_type' => 'open_attendance_auto_closed',
                            'source_employee_id' => $empId,
                            'speak_text' => $speak,
                            'closed_date' => $recDate
                        ]
                    );
                    createNotification(
                        $empId,
                        'employee',
                        'Attendance Technical Issue',
                        "Technical issue, no need to worry. Your attendance for {$recDate} was closed at 9:30 PM for review.",
                        'warning',
                        [
                            'event_id' => "auto_close_emp:{$empId}:{$recDate}:created",
                            'event_type' => 'open_attendance_auto_closed_emp',
                            'speak_text' => 'Technical issue, no need to worry. Your attendance was closed at 9:30 PM for review.',
                        ]
                    );
                }
            }
        }
    } catch (Exception $e) {}
}


/**
 * Convert MongoDB objects to JSON-safe format
 * Recursively sanitizes all MongoDB objects, BSONDocuments, UTCDateTime, ObjectId, etc.
 */
function sanitizeForJson(mixed $value): mixed
{
    if ($value instanceof MongoDB\BSON\UTCDateTime) {
        return $value->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
    }
    if ($value instanceof MongoDB\BSON\ObjectId) {
        return (string)$value;
    }
    // Handle $date arrays from JSON import BEFORE generic array handling
    if (is_array($value) && isset($value['$date']) && count($value) === 1) {
        try {
            $dt = new DateTime($value['$date']);
            return $dt->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
        } catch (Exception) {
            return '';
        }
    }
    if ($value instanceof MongoDB\Model\BSONDocument || is_object($value)) {
        $value = (array)$value;
    }
    if (is_array($value)) {
        $result = [];
        foreach ($value as $k => $v) {
            $result[$k] = sanitizeForJson($v);
        }
        return $result;
    }
    return $value;
}
