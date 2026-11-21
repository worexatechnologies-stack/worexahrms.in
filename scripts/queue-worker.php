<?php
declare(strict_types=1);

/**
 * HRMS Background Queue Worker
 *
 * Runs scheduled asynchronous tasks (notifications, reports, cache warming)
 * from the MongoDB-backed jobs collection.
 *
 * Execution:
 *   CLI: php scripts/queue-worker.php
 *   cPanel Cron recommended schedule: Every minute
 *     * * * * * php -d register_argc_argv=On /home/<cpanel_user>/public_html/scripts/queue-worker.php >/dev/null 2>&1
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo "Forbidden: CLI execution only.\n";
    exit(1);
}

ini_set('display_errors', '0');
ini_set('log_errors', '1');
date_default_timezone_set('Asia/Kolkata');

require_once __DIR__ . '/../api/config/bootstrap.php';
require_once __DIR__ . '/../api/config/mongodb-helpers.php';
require_once __DIR__ . '/../api/config/queue.php';

$lockFilePath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'hrms_queue_worker.lock';
$lockHandle = @fopen($lockFilePath, 'c+');

if (!$lockHandle || !flock($lockHandle, LOCK_EX | LOCK_NB)) {
    echo "[" . date('Y-m-d H:i:s') . "] [WORKER] Another queue worker process is active. Exiting.\n";
    exit(0);
}

register_shutdown_function(function() use ($lockHandle) {
    if (is_resource($lockHandle)) {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
});

// Maximum worker runtime: 50 seconds to cleanly complete before next 1-minute cron trigger
$maxRuntimeSeconds = 50;
$workerStartTime = time();
$processedJobs = 0;
$failedJobs = 0;

echo "====================================================================\n";
echo " HRMS Background Job Worker Started: " . date('Y-m-d H:i:s T') . "\n";
echo "====================================================================\n";

$companies = get_registered_companies();

while ((time() - $workerStartTime) < $maxRuntimeSeconds) {
    $foundJobInCycle = false;

    foreach ($companies as $comp) {
        $dbName = $comp['db_name'] ?? 'hrms';
        set_active_db_name($dbName);

        $job = queue_reserve('default', 120, $dbName);
        if (!$job) {
            continue;
        }

        $foundJobInCycle = true;
        $jobId = $job['_id'];
        $type = (string)($job['type'] ?? 'unknown');
        $payload = (array)($job['payload'] ?? []);
        $attempt = (int)($job['attempts'] ?? 1);

        echo "[Tenant: {$dbName}] Processing job #{$jobId} [type: {$type}, attempt: {$attempt}]...\n";

        try {
            // Job Handlers Dispatcher
            match ($type) {
                'notification' => (function() use ($payload, $dbName) {
                    $recipientId = $payload['user_id'] ?? ($payload['employee_id'] ?? null);
                    if ($recipientId) {
                        insertOne(collection('notifications', $dbName), [
                            'user_id'    => (string)$recipientId,
                            'title'      => (string)($payload['title'] ?? 'HRMS Notification'),
                            'message'    => (string)($payload['message'] ?? ''),
                            'type'       => (string)($payload['notify_type'] ?? 'info'),
                            'is_read'    => false,
                            'created_at' => new MongoDB\BSON\UTCDateTime(),
                        ]);
                    }
                })(),

                'attendance_cleanup' => (function() {
                    markMissedAttendanceAbsent();
                    closeAllOpenSessions();
                })(),

                default => error_log("[HRMS WORKER] Unknown job type '{$type}' in job #{$jobId}"),
            };

            queue_complete($jobId, $dbName);
            $processedJobs++;
            echo "  - Completed job #{$jobId} successfully.\n";

        } catch (Throwable $e) {
            $failedJobs++;
            $errMsg = $e->getMessage();
            error_log("[HRMS WORKER ERROR] Job #{$jobId} failed: {$errMsg}");
            queue_fail($jobId, $errMsg, $dbName);
            echo "  - [FAILED] Job #{$jobId}: {$errMsg}\n";
        }

        // Brief pause between jobs to minimize CPU spikes
        usleep(50000); // 50ms
    }

    if (!$foundJobInCycle) {
        // Sleep 1 second before checking next pending batch
        sleep(1);
    }
}

$elapsed = time() - $workerStartTime;
echo "====================================================================\n";
echo " Worker finished in {$elapsed}s. Processed: {$processedJobs}, Failed: {$failedJobs}.\n";
echo "====================================================================\n";
