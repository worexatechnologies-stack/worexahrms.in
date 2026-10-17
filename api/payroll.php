<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$curr = current_user();
$data = input();
$action = $_GET['action'] ?? ($data['action'] ?? '');

$months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
           'July', 'August', 'September', 'October', 'November', 'December'];

/* ─── GET payroll ─────────────────────────────────────────────────── */
if (method() === 'GET') {
    // 1. Check if monthly payroll is due for HR
    if ($action === 'check_monthly_due') {
        if ($curr['role'] !== 'hr') fail('Only HR can check monthly payroll status.', 403);

        $now = new DateTime('now', new DateTimeZone('Asia/Kolkata'));
        $prevDate = (clone $now)->modify('-1 month');
        $prevMonth = (int)$prevDate->format('n');
        $prevYear  = (int)$prevDate->format('Y');

        $currMonth = (int)$now->format('n');
        $currYear  = (int)$now->format('Y');

        // Find active employees
        $activeEmps = findMany(collection('employees'), [
            'status' => 'active',
            'role'   => 'employee'
        ]);
        $activeCount = count($activeEmps);

        // Allow explicit override if passed in query param
        if (!empty($_GET['month']) && !empty($_GET['year'])) {
            $targetMonth = (int)$_GET['month'];
            $targetYear  = (int)$_GET['year'];
        } else {
            // First check if previous month is missing any active employee payroll
            $payrollsPrev = findMany(collection('payroll'), ['month' => $prevMonth, 'year' => $prevYear]);
            $generatedIdsPrev = array_map(fn($p) => (string)$p['employee_id'], $payrollsPrev);
            $missingPrev = array_values(array_filter($activeEmps, fn($e) => !in_array((string)$e['_id'], $generatedIdsPrev, true)));

            if (count($missingPrev) > 0) {
                $targetMonth = $prevMonth;
                $targetYear  = $prevYear;
            } else {
                // Previous month is complete. Target current month
                $targetMonth = $currMonth;
                $targetYear  = $currYear;
            }
        }

        if ($targetMonth < 1 || $targetMonth > 12) $targetMonth = $currMonth;
        if ($targetYear < 2000 || $targetYear > 2100) $targetYear = $currYear;

        // Find existing payrolls for target period
        $payrollsForPeriod = findMany(collection('payroll'), [
            'month' => $targetMonth,
            'year'  => $targetYear,
        ]);

        $generatedEmpIds = array_map(fn($p) => (string)$p['employee_id'], $payrollsForPeriod);
        $draftCount = 0;
        $publishedCount = 0;
        foreach ($payrollsForPeriod as $p) {
            if (($p['status'] ?? 'published') === 'draft') {
                $draftCount++;
            } else {
                $publishedCount++;
            }
        }

        $missingEmps = array_values(array_filter($activeEmps, fn($e) => !in_array((string)$e['_id'], $generatedEmpIds, true)));
        $missingCount = count($missingEmps);
        $isDue = ($missingCount > 0 && $activeCount > 0);

        $targetMonthName = $months[$targetMonth] ?? 'Unknown';

        // Auto-create HR notification if due and not notified yet
        if ($isDue) {
            $notifKey = "payroll_due_{$targetYear}_{$targetMonth}";
            try {
                $existingNotif = findOne(collection('notifications'), [
                    'user_id'  => $curr['id'],
                    'event_id' => $notifKey,
                ]);
                if (!$existingNotif) {
                    insertOne(collection('notifications'), [
                        'user_id'    => $curr['id'],
                        'role'       => 'hr',
                        'title'      => "Monthly Payroll Due: {$targetMonthName} {$targetYear}",
                        'message'    => "Payslips for {$missingCount} active employee(s) need to be generated for {$targetMonthName} {$targetYear}.",
                        'type'       => 'warning',
                        'event_type' => 'payroll_due',
                        'event_id'   => $notifKey,
                        'is_read'    => false,
                        'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
                    ]);
                }
            } catch (Exception) {}
        }

        ok([
            'due'               => $isDue,
            'target_month'      => $targetMonth,
            'target_month_name' => $targetMonthName,
            'target_year'       => $targetYear,
            'active_employees'  => $activeCount,
            'generated_count'   => count($payrollsForPeriod),
            'missing_count'     => $missingCount,
            'draft_count'       => $draftCount,
            'published_count'   => $publishedCount,
        ]);
    }

    $page    = max(1, (int) ($_GET['page'] ?? 1));
    $perPage = min(100, max(10, (int) ($_GET['per_page'] ?? 50)));
    $skip    = ($page - 1) * $perPage;

    if ($curr['role'] === 'hr') {
        $yearFilter   = !empty($_GET['year']) ? (int) $_GET['year'] : null;
        $monthFilter  = !empty($_GET['month']) ? (int) $_GET['month'] : null;
        $statusFilter = trim($_GET['status'] ?? '');
        $empIdFilter  = trim($_GET['employee_id'] ?? '');

        $filter = [];
        if ($yearFilter)         $filter['year']        = $yearFilter;
        if ($monthFilter)        $filter['month']       = $monthFilter;
        if ($empIdFilter !== '') $filter['employee_id'] = $empIdFilter;
        if ($statusFilter !== '' && $statusFilter !== 'all') {
            if ($statusFilter === 'published') {
                $filter['$or'] = [
                    ['status' => 'published'],
                    ['status' => ['$exists' => false]],
                ];
            } else {
                $filter['status'] = $statusFilter;
            }
        }

        $total   = countDocs(collection('payroll'), $filter);
        $records = findMany(collection('payroll'), $filter, [
            'sort'  => ['year' => -1, 'month' => -1, '_id' => -1],
            'skip'  => $skip,
            'limit' => $perPage,
        ]);

        // Bulk-enrich with employee data
        $empIds = array_unique(array_column($records, 'employee_id'));
        $empMap = [];
        if ($empIds) {
            $validIds = array_values(array_filter($empIds, fn($id) => preg_match('/^[a-f\d]{24}$/i', (string)$id)));
            if ($validIds) {
                $emps = findMany(collection('employees'), ['_id' => ['$in' => array_map(fn($id) => mongoId($id), $validIds)]]);
                foreach ($emps as $e) { $empMap[(string)$e['_id']] = $e; }
            }
        }
        foreach ($records as &$r) {
            $r['id']            = (string) $r['_id'];
            $r['status']        = $r['status'] ?? 'published'; // Default legacy to published
            $emp                = $empMap[$r['employee_id']] ?? null;
            $r['employee_name'] = $emp['name'] ?? 'Unknown';
            $r['employee_code'] = $emp['employee_code'] ?? '';
            $r['department']    = $emp['department'] ?? '';
            $r['designation']   = $emp['designation'] ?? '';
        }
        ok(['payroll' => $records, 'pagination' => ['page' => $page, 'total' => $total, 'per_page' => $perPage]]);
    }

    // Employee: own payroll (STRICTLY filter out draft so employees only see published)
    $filter  = [
        'employee_id' => $curr['id'],
        'status'      => ['$ne' => 'draft']
    ];
    $total   = countDocs(collection('payroll'), $filter);
    $records = findMany(collection('payroll'), $filter, [
        'sort'  => ['year' => -1, 'month' => -1],
        'skip'  => $skip,
        'limit' => $perPage,
    ]);
    foreach ($records as &$r) {
        $r['id']     = (string) $r['_id'];
        $r['status'] = $r['status'] ?? 'published';
    }
    ok(['payroll' => $records, 'pagination' => ['page' => $page, 'total' => $total, 'per_page' => $perPage]]);
}

/* ─── POST actions (HR only) ─────────────────────────────────────── */
if (method() === 'POST') {
    if ($curr['role'] !== 'hr') fail('Only HR can manage payroll.', 403);

    // 1. Bulk generate draft payroll for all active employees
    if ($action === 'bulk_generate') {
        require_fields($data, ['month', 'year']);
        $month = (int) $data['month'];
        $year  = (int) $data['year'];

        if ($month < 1 || $month > 12) fail('Invalid month.', 422);
        if ($year < 2000 || $year > 2100) fail('Invalid year.', 422);

        $activeEmps = findMany(collection('employees'), [
            'status' => 'active',
            'role'   => 'employee'
        ]);

        $generatedCount = 0;
        $skippedCount   = 0;
        $timestamp      = date('Y-m-d H:i:s');

        foreach ($activeEmps as $emp) {
            $empId = (string) $emp['_id'];

            // Check if already generated
            $existing = findOne(collection('payroll'), [
                'employee_id' => $empId,
                'month'       => $month,
                'year'        => $year,
            ]);

            if ($existing) {
                $skippedCount++;
                continue;
            }

            $basic = (float)($emp['basic_salary'] ?? 0);
            $allowances = 0.0;
            $deductions = 0.0;
            $net = $basic + $allowances - $deductions;

            try {
                $payroll = insertOne(collection('payroll'), [
                    'employee_id'  => $empId,
                    'month'        => $month,
                    'year'         => $year,
                    'basic_salary' => $basic,
                    'allowances'   => $allowances,
                    'deductions'   => $deductions,
                    'net_salary'   => $net,
                    'status'       => 'draft', // Draft mode: HR reviews & edits before sending
                    'created_at'   => $timestamp,
                    'updated_at'   => $timestamp,
                ]);

                $payrollId = (string) $payroll['_id'];

                insertOne(collection('payslips'), [
                    'payroll_id' => $payrollId,
                    'created_at' => $timestamp,
                ]);

                $generatedCount++;
            } catch (Exception) {
                $skippedCount++;
            }
        }

        $monthName = $months[$month] ?? 'Selected month';
        ok([
            'generated_count' => $generatedCount,
            'skipped_count'   => $skippedCount,
            'month'           => $month,
            'year'            => $year,
        ], "Generated {$generatedCount} draft payslip(s) for {$monthName} {$year}.");
    }

    // 2. Update existing payroll record (Edit basic, allowances, deductions)
    if ($action === 'update' || (isset($_GET['id']) && empty($action))) {
        $id = $_GET['id'] ?? ($data['id'] ?? '');
        if (!$id || !preg_match('/^[a-f\d]{24}$/i', (string)$id)) fail('Invalid payroll ID.', 400);

        $existing = findOne(collection('payroll'), ['_id' => mongoId($id)]);
        if (!$existing) fail('Payroll record not found.', 404);

        $basic      = isset($data['basic_salary']) ? (float)$data['basic_salary'] : (float)($existing['basic_salary'] ?? 0);
        $allowances = isset($data['allowances'])   ? (float)$data['allowances']   : (float)($existing['allowances'] ?? 0);
        $deductions = isset($data['deductions'])   ? (float)$data['deductions']   : (float)($existing['deductions'] ?? 0);
        $net        = $basic + $allowances - $deductions;

        $updateFields = [
            'basic_salary' => $basic,
            'allowances'   => $allowances,
            'deductions'   => $deductions,
            'net_salary'   => $net,
            'updated_at'   => date('Y-m-d H:i:s'),
        ];

        // If explicitly publishing on update
        if (!empty($data['publish'])) {
            $updateFields['status'] = 'published';
            $updateFields['published_at'] = date('Y-m-d H:i:s');

            // Notify employee
            $month = (int)$existing['month'];
            $year  = (int)$existing['year'];
            $monthName = $months[$month] ?? 'Unknown';
            try {
                insertOne(collection('notifications'), [
                    'user_id'    => (string)$existing['employee_id'],
                    'role'       => 'employee',
                    'title'      => 'Payslip Published',
                    'message'    => "Your payslip for {$monthName} {$year} is ready. Net salary: ₹" . number_format($net, 2),
                    'type'       => 'success',
                    'event_type' => 'payslip_published',
                    'event_id'   => "payslip_{$id}",
                    'is_read'    => false,
                    'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
                ]);
            } catch (Exception) {}
        }

        updateOne(collection('payroll'), ['_id' => mongoId($id)], $updateFields);
        ok(['id' => $id, 'net_salary' => $net], 'Payroll record updated successfully.');
    }

    // 3. Publish single draft payslip (Send to individual employee)
    if ($action === 'publish') {
        $id = $_GET['id'] ?? ($data['id'] ?? '');
        if (!$id || !preg_match('/^[a-f\d]{24}$/i', (string)$id)) fail('Invalid payroll ID.', 400);

        $existing = findOne(collection('payroll'), ['_id' => mongoId($id)]);
        if (!$existing) fail('Payroll record not found.', 404);

        updateOne(collection('payroll'), ['_id' => mongoId($id)], [
            'status'       => 'published',
            'published_at' => date('Y-m-d H:i:s'),
            'updated_at'   => date('Y-m-d H:i:s'),
        ]);

        $month = (int)$existing['month'];
        $year  = (int)$existing['year'];
        $monthName = $months[$month] ?? 'Unknown';
        $net = (float)($existing['net_salary'] ?? 0);

        try {
            insertOne(collection('notifications'), [
                'user_id'    => (string)$existing['employee_id'],
                'role'       => 'employee',
                'title'      => 'Payslip Published',
                'message'    => "Your payslip for {$monthName} {$year} is ready. Net salary: ₹" . number_format($net, 2),
                'type'       => 'success',
                'event_type' => 'payslip_published',
                'event_id'   => "payslip_{$id}",
                'is_read'    => false,
                'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
            ]);
        } catch (Exception) {}

        ok(['id' => $id], "Payslip sent to employee.");
    }

    // 4. Publish all draft payslips for a given month/year (Send to All)
    if ($action === 'publish_all') {
        $filter = ['status' => 'draft'];
        if (!empty($data['month'])) $filter['month'] = (int)$data['month'];
        if (!empty($data['year']))  $filter['year']  = (int)$data['year'];

        $drafts = findMany(collection('payroll'), $filter);
        $publishedCount = 0;
        $timestamp = date('Y-m-d H:i:s');

        foreach ($drafts as $d) {
            $pId = (string)$d['_id'];
            updateOne(collection('payroll'), ['_id' => $d['_id']], [
                'status'       => 'published',
                'published_at' => $timestamp,
                'updated_at'   => $timestamp,
            ]);

            $month = (int)$d['month'];
            $year  = (int)$d['year'];
            $monthName = $months[$month] ?? 'Unknown';
            $net = (float)($d['net_salary'] ?? 0);

            try {
                insertOne(collection('notifications'), [
                    'user_id'    => (string)$d['employee_id'],
                    'role'       => 'employee',
                    'title'      => 'Payslip Published',
                    'message'    => "Your payslip for {$monthName} {$year} is ready. Net salary: ₹" . number_format($net, 2),
                    'type'       => 'success',
                    'event_type' => 'payslip_published',
                    'event_id'   => "payslip_{$pId}",
                    'is_read'    => false,
                    'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
                ]);
            } catch (Exception) {}

            $publishedCount++;
        }

        ok(['published_count' => $publishedCount], "Published and sent {$publishedCount} payslip(s) to employees.");
    }

    // 5. Default single payroll generation
    require_fields($data, ['employee_id', 'month', 'year', 'basic_salary']);

    $empId = (string) $data['employee_id'];
    $month = (int) $data['month'];
    $year  = (int) $data['year'];

    if ($month < 1 || $month > 12) fail('Invalid month.', 422);
    if ($year < 2000 || $year > 2100) fail('Invalid year.', 422);

    $basic      = (float) $data['basic_salary'];
    $allowances = (float) ($data['allowances'] ?? 0);
    $deductions = (float) ($data['deductions'] ?? 0);
    $net        = $basic + $allowances - $deductions;
    $status     = !empty($data['status']) ? (string)$data['status'] : 'draft';

    // Verify employee exists
    $emp = findOne(collection('employees'), ['_id' => mongoId($empId)]);
    if (!$emp) fail('Employee not found.', 404);

    try {
        $payroll = insertOne(collection('payroll'), [
            'employee_id' => $empId,
            'month'       => $month,
            'year'        => $year,
            'basic_salary'=> $basic,
            'allowances'  => $allowances,
            'deductions'  => $deductions,
            'net_salary'  => $net,
            'status'      => $status,
            'created_at'  => date('Y-m-d H:i:s'),
            'updated_at'  => date('Y-m-d H:i:s'),
        ]);
    } catch (Exception $e) {
        if ($e->getCode() === 409) fail('Payroll already generated for this period.', 409);
        fail('Failed to generate payroll.', 500);
    }

    $payrollId = (string) $payroll['_id'];

    // Create payslip record
    try {
        insertOne(collection('payslips'), [
            'payroll_id' => $payrollId,
            'created_at' => date('Y-m-d H:i:s'),
        ]);
    } catch (Exception) {}

    // If published, notify employee
    if ($status === 'published') {
        $monthName = $months[$month] ?? 'Unknown';
        try {
            insertOne(collection('notifications'), [
                'user_id'    => $empId,
                'role'       => 'employee',
                'title'      => 'Payslip Generated',
                'message'    => "Your payslip for {$monthName} {$year} is ready. Net salary: ₹" . number_format($net, 2),
                'type'       => 'info',
                'is_read'    => false,
                'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
            ]);
        } catch (Exception) {}
    }

    ok(['id' => $payrollId, 'net_salary' => $net, 'status' => $status], 'Payroll generated.', 201);
}

/* ─── PUT payroll (update) ────────────────────────────────────────── */
if (method() === 'PUT') {
    if ($curr['role'] !== 'hr') fail('Only HR can update payroll records.', 403);
    $id = $_GET['id'] ?? ($data['id'] ?? '');
    if (!$id || !preg_match('/^[a-f\d]{24}$/i', (string)$id)) fail('Invalid payroll ID.', 400);

    $existing = findOne(collection('payroll'), ['_id' => mongoId($id)]);
    if (!$existing) fail('Payroll record not found.', 404);

    $basic      = isset($data['basic_salary']) ? (float)$data['basic_salary'] : (float)($existing['basic_salary'] ?? 0);
    $allowances = isset($data['allowances'])   ? (float)$data['allowances']   : (float)($existing['allowances'] ?? 0);
    $deductions = isset($data['deductions'])   ? (float)$data['deductions']   : (float)($existing['deductions'] ?? 0);
    $net        = $basic + $allowances - $deductions;

    $updateFields = [
        'basic_salary' => $basic,
        'allowances'   => $allowances,
        'deductions'   => $deductions,
        'net_salary'   => $net,
        'updated_at'   => date('Y-m-d H:i:s'),
    ];

    if (!empty($data['publish'])) {
        $updateFields['status'] = 'published';
        $updateFields['published_at'] = date('Y-m-d H:i:s');

        $month = (int)$existing['month'];
        $year  = (int)$existing['year'];
        $monthName = $months[$month] ?? 'Unknown';
        try {
            insertOne(collection('notifications'), [
                'user_id'    => (string)$existing['employee_id'],
                'role'       => 'employee',
                'title'      => 'Payslip Published',
                'message'    => "Your payslip for {$monthName} {$year} is ready. Net salary: ₹" . number_format($net, 2),
                'type'       => 'success',
                'event_type' => 'payslip_published',
                'event_id'   => "payslip_{$id}",
                'is_read'    => false,
                'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
            ]);
        } catch (Exception) {}
    }

    updateOne(collection('payroll'), ['_id' => mongoId($id)], $updateFields);
    ok(['id' => $id, 'net_salary' => $net], 'Payroll record updated successfully.');
}

/* ─── DELETE payroll (HR only) ────────────────────────────────────── */
if (method() === 'DELETE') {
    if ($curr['role'] !== 'hr') fail('Only HR can delete payroll records.', 403);
    $id = $_GET['id'] ?? '';
    if (!$id || !preg_match('/^[a-f\d]{24}$/i', (string)$id)) {
        fail('Invalid payroll ID.', 400);
    }

    try {
        $payrollCollection = collection('payroll');
        $result = $payrollCollection->deleteOne(['_id' => mongoId($id)]);
        if ($result->getDeletedCount() === 0) {
            fail('Payroll record not found.', 404);
        }

        // Also delete the associated payslip
        collection('payslips')->deleteMany(['payroll_id' => $id]);

        ok(null, 'Payroll and associated payslip deleted successfully.');
    } catch (Exception $e) {
        fail('Failed to delete payroll record: ' . $e->getMessage(), 500);
    }
}

fail('Method not allowed.', 405);
