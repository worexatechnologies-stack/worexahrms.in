<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$curr = current_user();
$data = input();

/* ─── GET payroll ─────────────────────────────────────────────────── */
if (method() === 'GET') {
    $page    = max(1, (int) ($_GET['page'] ?? 1));
    $perPage = min(100, max(10, (int) ($_GET['per_page'] ?? 50)));
    $skip    = ($page - 1) * $perPage;

    if ($curr['role'] === 'hr') {
        $yearFilter = !empty($_GET['year']) ? (int) $_GET['year'] : null;
        $filter = $yearFilter ? ['year' => $yearFilter] : [];

        $total   = countDocs(collection('payroll'), $filter);
        $records = findMany(collection('payroll'), $filter, [
            'sort'  => ['year' => -1, 'month' => -1],
            'skip'  => $skip,
            'limit' => $perPage,
        ]);

        // Bulk-enrich with employee data (avoids N+1)
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
            $r['id'] = (string) $r['_id'];
            $emp = $empMap[$r['employee_id']] ?? null;
            $r['employee_name'] = $emp['name'] ?? 'Unknown';
            $r['employee_code'] = $emp['employee_code'] ?? '';
            $r['department']    = $emp['department'] ?? '';
            $r['designation']   = $emp['designation'] ?? '';
        }
        ok(['payroll' => $records, 'pagination' => ['page' => $page, 'total' => $total, 'per_page' => $perPage]]);
    }

    // Employee: own payroll
    $filter  = ['employee_id' => $curr['id']];
    $total   = countDocs(collection('payroll'), $filter);
    $records = findMany(collection('payroll'), $filter, [
        'sort'  => ['year' => -1, 'month' => -1],
        'skip'  => $skip,
        'limit' => $perPage,
    ]);
    foreach ($records as &$r) { $r['id'] = (string) $r['_id']; }
    ok(['payroll' => $records, 'pagination' => ['page' => $page, 'total' => $total, 'per_page' => $perPage]]);
}

/* ─── POST generate payroll (HR only) ────────────────────────────── */
if (method() === 'POST') {
    if ($curr['role'] !== 'hr') fail('Only HR can generate payroll.', 403);
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
            'created_at'  => date('Y-m-d H:i:s'),
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
    } catch (Exception) {} // Silently ignore if payslip already exists

    // Notify employee
    $months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
               'July', 'August', 'September', 'October', 'November', 'December'];
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

    ok(['id' => $payrollId, 'net_salary' => $net], 'Payroll and payslip generated.', 201);
}

fail('Method not allowed.', 405);
