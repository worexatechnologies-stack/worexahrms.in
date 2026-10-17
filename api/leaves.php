<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$user = current_user();
$data = input();
$id   = id_param();

/* ─── helpers ────────────────────────────────────────────────────── */
function notifyHrLeave(array $user, array $data, string $leaveId): void
{
    $hrs = findMany(collection('users'), ['role' => 'hr']);
    if (!$hrs) return;
    [$message, $speak] = cleanHrEmployeeMessage($user['id'], 'has requested leave');
    $leaveLabel = ucwords(str_replace('_', ' ', (string)($data['leave_type'] ?? 'leave')));
    $range = $data['start_date'] === $data['end_date']
        ? (string)$data['start_date']
        : ((string)$data['start_date'] . ' to ' . (string)$data['end_date']);
    $hrMessage = "{$message} ({$leaveLabel}, {$range}).";
    foreach ($hrs as $hr) {
        try {
            createNotification(
                (string)$hr['_id'],
                'hr',
                'New Leave Request',
                $hrMessage,
                'info',
                [
                    'event_id' => 'leave_request:' . $leaveId . ':created:hr:' . (string)$hr['_id'],
                    'event_type' => 'leave_request.created',
                    'source_employee_id' => $user['id'],
                    'source_request_id' => $leaveId,
                    'speak_text' => $speak,
                    'visual_reason' => (string)($data['reason'] ?? ''),
                    'leave_type' => (string)($data['leave_type'] ?? ''),
                    'leave_start' => (string)($data['start_date'] ?? ''),
                    'leave_end' => (string)($data['end_date'] ?? ''),
                ]
            );
        } catch (Exception) {}
    }
}

function notifyEmployeeLeave(string $empId, string $leaveId, string $leaveType, string $start, string $end, string $status): void
{
    try {
        $verb = $status === 'approved' ? 'approved' : 'rejected';
        $range = $start === $end
            ? $start
            : ($start . ' to ' . $end);
        $msg = "Your " . ucwords(str_replace('_', ' ', $leaveType)) . " request for {$range} has been {$verb}.";
        $speak = "Your " . $leaveType . " leave request for {$range} has been {$verb}.";
        createNotification(
            $empId,
            'employee',
            'Leave ' . ucfirst($verb),
            $msg,
            $status === 'approved' ? 'success' : 'error',
            [
                'event_id' => "leave_request:{$leaveId}:{$status}:{$empId}",
                'event_type' => 'leave_request.' . $status,
                'source_employee_id' => $empId,
                'source_request_id' => $leaveId,
                'speak_text' => $speak,
                'leave_type' => $leaveType,
                'leave_start' => $start,
                'leave_end' => $end,
            ]
        );
    } catch (Exception) {}
}

/* ─── GET ─────────────────────────────────────────────────────────── */
if (method() === 'GET') {
    $page    = max(1, (int) ($_GET['page'] ?? 1));
    $perPage = min(100, max(10, (int) ($_GET['per_page'] ?? 50)));
    $skip    = ($page - 1) * $perPage;

    if ($user['role'] === 'hr') {
        $statusFilter = $_GET['status'] ?? '';
        $filter = $statusFilter !== '' ? ['status' => $statusFilter] : [];
        // Optional: filter by a specific employee (used by HR employee detail modal)
        $empIdFilter = trim($_GET['employee_id'] ?? '');
        if ($empIdFilter !== '') {
            $filter['employee_id'] = $empIdFilter;
        }
        $total  = countDocs(collection('leaves'), $filter);
        $leaves = findMany(collection('leaves'), $filter, [
            'sort'  => ['created_at' => -1],
            'skip'  => $skip,
            'limit' => $perPage,
        ]);

        $empIds = array_values(array_unique(array_filter(array_column($leaves, 'employee_id'))));
        $empMap = [];
        if ($empIds) {
            $emps = findMany(collection('employees'), ['_id' => ['$in' => array_map(fn($id) => mongoId($id), $empIds)]]);
            foreach ($emps as $e) { $empMap[(string)$e['_id']] = $e; }
        }
        foreach ($leaves as &$l) {
            $l['id'] = (string) $l['_id'];
            unset($l['_id']);
            $emp = $empMap[$l['employee_id']] ?? null;
            $l['employee_name'] = $emp['name'] ?? 'Unknown';
            $l['employee_code'] = $emp['employee_code'] ?? '';
            $l['branch']        = $emp['branch'] ?? '';
            $l['department']    = $emp['department'] ?? '';
            $l['profile_image'] = $emp['profile_image'] ?? null;
            // Handle dates
            if (isset($l['created_at'])) {
                if ($l['created_at'] instanceof MongoDB\BSON\UTCDateTime) {
                    $l['created_at'] = $l['created_at']->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
                } elseif ($l['created_at'] instanceof MongoDB\Model\BSONDocument && isset($l['created_at']['$date'])) {
                    try {
                        $dt = new DateTime($l['created_at']['$date']);
                        $l['created_at'] = $dt->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
                    } catch (Exception) {
                        $l['created_at'] = '';
                    }
                }
            }
        }
        unset($l);
        ok(sanitizeForJson(['leaves' => $leaves, 'pagination' => ['page' => $page, 'total' => $total, 'per_page' => $perPage]]));
    }

    // Employee: own leaves
    $filter = ['employee_id' => $user['id']];
    $total  = countDocs(collection('leaves'), $filter);
    $leaves = findMany(collection('leaves'), $filter, [
        'sort'  => ['created_at' => -1],
        'skip'  => $skip,
        'limit' => $perPage,
    ]);
    foreach ($leaves as &$l) {
        $l['id'] = (string) $l['_id'];
        unset($l['_id']);
        // Handle dates
        if (isset($l['created_at'])) {
            if ($l['created_at'] instanceof MongoDB\BSON\UTCDateTime) {
                $l['created_at'] = $l['created_at']->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
            } elseif ($l['created_at'] instanceof MongoDB\Model\BSONDocument && isset($l['created_at']['$date'])) {
                try {
                    $dt = new DateTime($l['created_at']['$date']);
                    $l['created_at'] = $dt->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
                } catch (Exception) {
                    $l['created_at'] = '';
                }
            }
        }
    }
    unset($l);
    ok(sanitizeForJson(['leaves' => $leaves, 'pagination' => ['page' => $page, 'total' => $total, 'per_page' => $perPage]]));
}

/* ─── POST (submit leave) ─────────────────────────────────────────── */
if (method() === 'POST') {
    require_fields($data, ['leave_type', 'start_date', 'end_date', 'reason']);
    $empId = ($user['role'] === 'hr' && !empty($data['employee_id']))
        ? (string) $data['employee_id']
        : $user['id'];

    try {
        $result = insertOne(collection('leaves'), [
            'employee_id' => $empId,
            'leave_type'  => trim($data['leave_type']),
            'start_date'  => $data['start_date'],
            'end_date'    => $data['end_date'],
            'reason'      => trim($data['reason']),
            'status'      => 'pending',
            'created_at'  => new MongoDB\BSON\UTCDateTime(time() * 1000),
        ]);
    } catch (Exception $e) {
        fail('Failed to submit leave request. Please try again.', 500);
    }

    notifyHrLeave($user, $data, (string)$result['_id']);
    ok(['id' => (string) $result['_id']], 'Leave request submitted.', 201);
}

/* ─── PUT (HR approve/reject) ─────────────────────────────────────── */
if (method() === 'PUT' && $id) {
    if ($user['role'] !== 'hr') fail('Only HR can update leave status.', 403);
    require_fields($data, ['status']);
    if (!in_array($data['status'], ['approved', 'rejected'], true)) fail('Invalid status.', 422);

    $leave = findOne(collection('leaves'), ['_id' => mongoId((string) $id)]);
    if (!$leave) fail('Leave request not found.', 404);
    if (($leave['status'] ?? '') === $data['status']) {
        ok(null, 'Leave request already ' . $data['status'] . '.');
    }

    updateOne(collection('leaves'), ['_id' => mongoId((string) $id)], ['status' => $data['status']]);

    // Sync employee status (Disabled so approved leaves do not deactivate the employee account)
    // $empId = $leave['employee_id'];
    // if ($data['status'] === 'approved') {
    //     updateOne(collection('employees'), ['_id' => mongoId($empId)], ['status' => 'inactive']);
    // } else {
    //     updateOne(collection('employees'), ['_id' => mongoId($empId)], ['status' => 'active']);
    // }

    notifyEmployeeLeave(
        $leave['employee_id'],
        (string)$leave['_id'],
        $leave['leave_type'],
        $leave['start_date'],
        $leave['end_date'],
        $data['status']
    );
    ok(null, 'Leave request ' . $data['status'] . '.');
}

fail('Method not allowed.', 405);
