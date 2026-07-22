<?php
/**
 * Activity Log API — HR only
 *
 * GET /api/activity-log.php
 *   ?date=YYYY-MM-DD          filter by single day
 *   ?from=YYYY-MM-DD          filter range start
 *   ?to=YYYY-MM-DD            filter range end
 *   ?type=warning|info|...    filter by notification type
 *   ?search=text              search in title/message
 *   ?page=1&per_page=20       pagination
 *
 * Also returns leave summary data for the same date range.
 */
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$user = current_user();
if ($user['role'] !== 'hr') fail('Access denied.', 403);

if (method() !== 'GET') fail('Method not allowed.', 405);

/* ── parse params ── */
$page    = max(1, (int)($_GET['page']     ?? 1));
$perPage = min(100, max(10, (int)($_GET['per_page'] ?? 20)));
$skip    = ($page - 1) * $perPage;

$singleDate = trim($_GET['date']   ?? '');
$fromDate   = trim($_GET['from']   ?? '');
$toDate     = trim($_GET['to']     ?? '');
$leaveDate  = trim($_GET['leave_date'] ?? '');
$leaveFrom  = trim($_GET['leave_from'] ?? '');
$leaveTo    = trim($_GET['leave_to'] ?? '');
$typeFilter = trim($_GET['type']   ?? '');
$search     = trim($_GET['search'] ?? '');

/* ── build notification filter ── */
$notifFilter = ['role' => 'hr'];

// Date range — created_at is stored as UTCDateTime
if ($singleDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $singleDate)) {
    $notifFilter['created_at'] = [
        '$gte' => new MongoDB\BSON\UTCDateTime(strtotime($singleDate . ' 00:00:00 Asia/Kolkata') * 1000),
        '$lte' => new MongoDB\BSON\UTCDateTime(strtotime($singleDate . ' 23:59:59 Asia/Kolkata') * 1000),
    ];
} elseif ($summaryFrom !== '' || $summaryTo !== '') {
    $range = [];
    if ($fromDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromDate)) {
        $range['$gte'] = new MongoDB\BSON\UTCDateTime(strtotime($fromDate . ' 00:00:00 Asia/Kolkata') * 1000);
    }
    if ($toDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $toDate)) {
        $range['$lte'] = new MongoDB\BSON\UTCDateTime(strtotime($toDate . ' 23:59:59 Asia/Kolkata') * 1000);
    }
    if ($range) $notifFilter['created_at'] = $range;
}

if ($typeFilter !== '') {
    $notifFilter['type'] = $typeFilter;
}

if ($search !== '') {
    $notifFilter['$or'] = [
        ['title'   => ['$regex' => $search, '$options' => 'i']],
        ['message' => ['$regex' => $search, '$options' => 'i']],
    ];
}

/* ── query notifications ── */
$total = countDocs(collection('notifications'), $notifFilter);
$docs  = findMany(collection('notifications'), $notifFilter, [
    'sort'  => ['created_at' => -1],
    'skip'  => $skip,
    'limit' => $perPage,
]);
$logs = array_map('formatNotification', $docs);

/* ── leaves summary for same date range ── */
$leaveFilter = [];
$summaryDate = $leaveDate !== '' ? $leaveDate : $singleDate;
$summaryFrom = ($leaveFrom !== '' || $leaveTo !== '') ? $leaveFrom : $fromDate;
$summaryTo   = ($leaveFrom !== '' || $leaveTo !== '') ? $leaveTo : $toDate;

if ($summaryDate !== '') {
    // Support both UTCDateTime (new records) and plain string (old records)
    $dayStart = new MongoDB\BSON\UTCDateTime(strtotime($summaryDate . ' 00:00:00 Asia/Kolkata') * 1000);
    $dayEnd   = new MongoDB\BSON\UTCDateTime(strtotime($summaryDate . ' 23:59:59 Asia/Kolkata') * 1000);
    $leaveFilter['$or'] = [
        ['created_at' => ['$gte' => $dayStart, '$lte' => $dayEnd]],
        ['created_at' => ['$gte' => $summaryDate . ' 00:00:00', '$lte' => $summaryDate . ' 23:59:59']],
    ];
} elseif ($fromDate !== '' || $toDate !== '') {
    $leaveFilter['$or'] = [];
    $utcRange  = [];
    $strRange  = [];
    if ($summaryFrom !== '') {
        $utcRange['$gte'] = new MongoDB\BSON\UTCDateTime(strtotime($summaryFrom . ' 00:00:00 Asia/Kolkata') * 1000);
        $strRange['$gte'] = $summaryFrom . ' 00:00:00';
    }
    if ($summaryTo !== '') {
        $utcRange['$lte'] = new MongoDB\BSON\UTCDateTime(strtotime($summaryTo . ' 23:59:59 Asia/Kolkata') * 1000);
        $strRange['$lte'] = $summaryTo . ' 23:59:59';
    }
    $leaveFilter['$or'] = [
        ['created_at' => $utcRange],
        ['created_at' => $strRange],
    ];
}

$leaveDocs = findMany(collection('leaves'), $leaveFilter, [
    'sort'  => ['created_at' => -1],
    'limit' => 200,
]);

// Bulk-enrich leaves with employee names
$empIds = array_unique(array_filter(array_column($leaveDocs, 'employee_id')));
$empMap = [];
if ($empIds) {
    $validIds = array_values(array_filter($empIds, fn($id) => preg_match('/^[a-f\d]{24}$/i', (string)$id)));
    if ($validIds) {
        $emps = findMany(collection('employees'), ['_id' => ['$in' => array_map(fn($id) => mongoId($id), $validIds)]]);
        foreach ($emps as $e) { $empMap[(string)$e['_id']] = $e; }
    }
}
foreach ($leaveDocs as &$l) {
    $l['id'] = (string)$l['_id'];
    $emp = $empMap[$l['employee_id']] ?? null;
    $l['employee_name'] = $emp['name'] ?? 'Unknown';
    $l['employee_code'] = $emp['employee_code'] ?? '';
    $l['department']    = $emp['department'] ?? '';
    $l['branch']        = $emp['branch'] ?? '';
}
unset($l);

// Leave status summary
$leaveSummary = ['total' => count($leaveDocs), 'pending' => 0, 'approved' => 0, 'rejected' => 0];
foreach ($leaveDocs as $l) { $leaveSummary[$l['status'] ?? 'pending'] = ($leaveSummary[$l['status'] ?? 'pending'] ?? 0) + 1; }

ok(sanitizeForJson([
    'logs'           => $logs,
    'pagination'     => ['page' => $page, 'total' => $total, 'per_page' => $perPage, 'pages' => (int)ceil($total / $perPage)],
    'leaves'         => $leaveDocs,
    'leave_summary'  => $leaveSummary,
    'filters_applied'=> array_filter([
        'date' => $singleDate,
        'from' => $fromDate,
        'to' => $toDate,
        'leave_date' => $leaveDate,
        'leave_from' => $leaveFrom,
        'leave_to' => $leaveTo,
        'type' => $typeFilter,
        'search' => $search
    ]),
]));
