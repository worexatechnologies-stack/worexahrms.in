<?php
declare(strict_types=1);

/**
 * HRMS Attendance Maintenance Cron Script
 *
 * Runs scheduled attendance lifecycle jobs:
 * 1. Closes open attendance sessions past cutoff (e.g. 21:30 IST) and finalizes active breaks.
 * 2. Marks employees absent who failed to check in on working days past the threshold.
 *
 * Execution:
 *   CLI: php scripts/attendance-cron.php
 *   cPanel Cron recommended schedule: Every 5 or 10 minutes
 *   Example cPanel Cron command:
 *     * /10 * * * * php -d register_argc_argv=On /home/<cpanel_user>/public_html/scripts/attendance-cron.php >/dev/null 2>&1
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo "Forbidden: CLI execution only.\n";
    exit(1);
}

// Ensure error logging and disable display
ini_set('display_errors', '0');
ini_set('log_errors', '1');
date_default_timezone_set('Asia/Kolkata');

require_once __DIR__ . '/../api/config/bootstrap.php';
require_once __DIR__ . '/../api/config/mongodb-helpers.php';

$lockFilePath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'hrms_attendance_maintenance.lock';
$lockHandle = @fopen($lockFilePath, 'c+');

if (!$lockHandle || !flock($lockHandle, LOCK_EX | LOCK_NB)) {
    echo "[" . date('Y-m-d H:i:s') . "] [CRON] Another attendance maintenance process is already running. Exiting.\n";
    exit(0);
}

// Release lock on shutdown
register_shutdown_function(function() use ($lockHandle, $lockFilePath) {
    if (is_resource($lockHandle)) {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
});

$startTime = hrtime(true);
echo "====================================================================\n";
echo " HRMS Scheduled Attendance Maintenance\n";
echo " Time: " . date('Y-m-d H:i:s T') . "\n";
echo "====================================================================\n";

$companies = get_registered_companies();
$successCount = 0;
$failCount = 0;

foreach ($companies as $comp) {
    $dbName = $comp['db_name'] ?? 'hrms';
    $name = $comp['name'] ?? $dbName;
    echo "Processing '{$name}' [Database: {$dbName}]...\n";

    set_active_db_name($dbName);

    try {
        $cStart = hrtime(true);
        // Step 1: Mark missed attendance as absent for previous working days
        markMissedAttendanceAbsent();

        // Step 2: Auto-close overdue open check-ins past cutoff
        closeAllOpenSessions();

        $cMs = (hrtime(true) - $cStart) / 1e6;
        echo "  - Completed maintenance in " . number_format($cMs, 2) . " ms.\n";
        $successCount++;
    } catch (Throwable $e) {
        $failCount++;
        error_log("[HRMS CRON ERROR] Tenant '{$dbName}': " . $e->getMessage());
        echo "  - [ERROR] " . $e->getMessage() . "\n";
    }
}

$totalMs = (hrtime(true) - $startTime) / 1e6;
echo "====================================================================\n";
echo " Completed: {$successCount} succeeded, {$failCount} failed. Total time: " . number_format($totalMs, 2) . " ms.\n";
echo "====================================================================\n";
