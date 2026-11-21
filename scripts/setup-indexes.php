<?php
/**
 * HRMS — MongoDB Index Setup Script
 * Run once after deployment: php scripts/setup-indexes.php
 *
 * Creates all required indexes for production performance and data integrity.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo json_encode(['error' => 'CLI only']);
    exit;
}

require_once __DIR__ . '/../api/config/bootstrap.php';
require_once __DIR__ . '/../api/config/mongodb-helpers.php';

$results = [];

function createIndex(string $collectionName, array $keys, array $options = []): string
{
    try {
        $col = collection($collectionName);
        $col->createIndex($keys, $options);
        $name = $options['name'] ?? implode('_', array_keys($keys));
        return "  ✅ {$collectionName}.{$name}";
    } catch (Throwable $e) {
        $name = $options['name'] ?? implode('_', array_keys($keys));
        return "  ❌ {$collectionName}.{$name}: " . $e->getMessage();
    }
}

echo PHP_EOL . "=== HRMS MongoDB Index Setup ===" . PHP_EOL . PHP_EOL;

// ─── employees ────────────────────────────────────────────────────────────────
echo "employees:" . PHP_EOL;
$results[] = createIndex('employees', ['employee_code' => 1], ['unique' => true, 'name' => 'uidx_employee_code']);
$results[] = createIndex('employees', ['email' => 1],          ['unique' => true, 'name' => 'uidx_employee_email']);
$results[] = createIndex('employees', ['status' => 1],         ['name' => 'idx_emp_status']);
$results[] = createIndex('employees', ['department' => 1, 'status' => 1], ['name' => 'idx_emp_dept_status']);
$results[] = createIndex('employees', ['branch' => 1, 'status' => 1],     ['name' => 'idx_emp_branch_status']);
$results[] = createIndex('employees', ['created_at' => -1],    ['name' => 'idx_emp_created_desc']);
$results[] = createIndex('employees', ['date_of_birth' => 1],  ['name' => 'idx_emp_dob']);

// ─── attendance ───────────────────────────────────────────────────────────────
echo "attendance:" . PHP_EOL;
$results[] = createIndex('attendance', ['employee_id' => 1, 'date' => 1], ['unique' => true, 'name' => 'uidx_att_emp_date']);
$results[] = createIndex('attendance', ['date' => -1],                    ['name' => 'idx_att_date_desc']);
$results[] = createIndex('attendance', ['employee_id' => 1, 'date' => -1],['name' => 'idx_att_emp_date_desc']);
$results[] = createIndex('attendance', ['date' => 1, 'status' => 1],      ['name' => 'idx_att_date_status']);
$results[] = createIndex('attendance', ['date' => -1, 'status' => 1],     ['name' => 'idx_att_date_desc_status']);
$results[] = createIndex('attendance', ['date' => 1, 'break_start_time' => 1], ['name' => 'idx_att_active_breaks']);

// ─── leaves ───────────────────────────────────────────────────────────────────
echo "leaves:" . PHP_EOL;
$results[] = createIndex('leaves', ['status' => 1],                        ['name' => 'idx_leave_status']);
$results[] = createIndex('leaves', ['employee_id' => 1, 'status' => 1],   ['name' => 'idx_leave_emp_status']);
$results[] = createIndex('leaves', ['employee_id' => 1, 'status' => 1, 'created_at' => -1], ['name' => 'idx_leave_emp_status_created']);
$results[] = createIndex('leaves', ['employee_id' => 1, 'created_at' => -1], ['name' => 'idx_leave_emp_created']);
$results[] = createIndex('leaves', ['created_at' => -1],                   ['name' => 'idx_leave_created_desc']);

// ─── break_requests ───────────────────────────────────────────────────────────
echo "break_requests:" . PHP_EOL;
$results[] = createIndex('break_requests', ['status' => 1, 'created_at' => 1],           ['name' => 'idx_break_status_created']);
$results[] = createIndex('break_requests', ['status' => 1, 'created_at' => -1],          ['name' => 'idx_break_status_created_desc']);
$results[] = createIndex('break_requests', ['employee_id' => 1, 'date' => 1, 'status' => 1], ['name' => 'idx_break_emp_date_status']);

// ─── payroll ──────────────────────────────────────────────────────────────────
echo "payroll:" . PHP_EOL;
$results[] = createIndex('payroll', ['employee_id' => 1, 'month' => 1, 'year' => 1], ['unique' => true, 'name' => 'uidx_payroll_emp_period']);
$results[] = createIndex('payroll', ['year' => -1, 'month' => -1],                   ['name' => 'idx_payroll_period_desc']);
$results[] = createIndex('payroll', ['employee_id' => 1, 'year' => -1],              ['name' => 'idx_payroll_emp_year']);

// ─── payslips ─────────────────────────────────────────────────────────────────
echo "payslips:" . PHP_EOL;
$results[] = createIndex('payslips', ['payroll_id' => 1], ['unique' => true, 'name' => 'uidx_payslip_payroll']);

// ─── notifications ────────────────────────────────────────────────────────────
echo "notifications:" . PHP_EOL;
$results[] = createIndex('notifications', ['user_id' => 1, 'role' => 1, 'created_at' => -1], ['name' => 'idx_notif_user_role_created']);
$results[] = createIndex('notifications', ['user_id' => 1, 'role' => 1, 'is_read' => 1],     ['name' => 'idx_notif_unread']);
$results[] = createIndex('notifications', ['user_id' => 1, 'is_read' => 1, 'created_at' => -1], ['name' => 'idx_notif_user_read_created']);
$results[] = createIndex('notifications', ['user_id' => 1, 'role' => 1, 'is_read' => 1, 'created_at' => -1], ['name' => 'idx_notif_user_role_read_created']);
// TTL: auto-delete notifications older than 90 days
$results[] = createIndex('notifications', ['created_at' => 1], ['expireAfterSeconds' => 7776000, 'name' => 'ttl_notif_90d']);

// ─── holidays ─────────────────────────────────────────────────────────────────
echo "holidays:" . PHP_EOL;
$results[] = createIndex('holidays', ['date' => 1], ['name' => 'idx_holiday_date']);
$results[] = createIndex('holidays', ['date' => 1], ['unique' => true, 'name' => 'uidx_holiday_date']);

// ─── break_sessions ───────────────────────────────────────────────────────────
echo "break_sessions:" . PHP_EOL;
$results[] = createIndex('break_sessions', ['employee_id' => 1], ['name' => 'idx_break_sess_emp']);
$results[] = createIndex('break_sessions', ['attendance_id' => 1], ['name' => 'idx_break_sess_att']);
$results[] = createIndex('break_sessions', ['break_type' => 1], ['name' => 'idx_break_sess_type']);
$results[] = createIndex('break_sessions', ['status' => 1], ['name' => 'idx_break_sess_status']);
$results[] = createIndex('break_sessions', ['started_at' => 1], ['name' => 'idx_break_sess_started']);

// ─── login_attempts (rate limiting) ──────────────────────────────────────────
echo "login_attempts:" . PHP_EOL;
$results[] = createIndex('login_attempts', ['ip' => 1, 'created_at' => -1], ['name' => 'idx_loginattempt_ip_created']);
// TTL: auto-delete attempts older than 15 minutes
$results[] = createIndex('login_attempts', ['created_at' => 1], ['expireAfterSeconds' => 900, 'name' => 'ttl_loginattempt_15m']);

// ─── jobs (background queue) ──────────────────────────────────────────────────
echo "jobs:" . PHP_EOL;
$results[] = createIndex('jobs', ['queue' => 1, 'status' => 1, 'available_at' => 1, 'attempts' => 1], ['name' => 'idx_jobs_queue_status_avail']);
$results[] = createIndex('jobs', ['created_at' => -1], ['name' => 'idx_jobs_created_desc']);

echo PHP_EOL;
foreach ($results as $r) echo $r . PHP_EOL;

$failed  = count(array_filter($results, fn($r) => str_starts_with($r, '  ❌')));
$success = count($results) - $failed;

echo PHP_EOL . "=== Done: {$success} created, {$failed} failed ===" . PHP_EOL;
if ($failed > 0) {
    echo "Note: 'already exists' failures are safe to ignore." . PHP_EOL;
}
echo PHP_EOL;
