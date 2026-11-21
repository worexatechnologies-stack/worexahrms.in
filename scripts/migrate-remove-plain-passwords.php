<?php
declare(strict_types=1);

/**
 * Migration Script: Remove Legacy Plaintext Passwords & Ensure Valid Hashes
 *
 * Usage:
 *   Dry-run mode (default, makes no changes):
 *     php scripts/migrate-remove-plain-passwords.php
 *
 *   Execute mode (applies migration):
 *     php scripts/migrate-remove-plain-passwords.php --execute
 *
 * Guarantees:
 *   - Strictly CLI only
 *   - Idempotent
 *   - Dry-run by default
 *   - Never prints actual passwords or password hashes to output
 *   - Ensures valid password hash exists before unsetting plain_password
 *   - Multi-tenant aware across all registered company databases
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo "Forbidden: CLI execution only.\n";
    exit(1);
}

// Bootstrap environment and MongoDB helpers
require_once __DIR__ . '/../api/config/bootstrap.php';
require_once __DIR__ . '/../api/config/mongodb-helpers.php';

$isExecute = in_array('--execute', $argv ?? [], true);
$modeLabel = $isExecute ? 'EXECUTE MODE (Writing changes)' : 'DRY-RUN MODE (No changes will be applied)';

echo "====================================================================\n";
echo " HRMS Security Migration: Plaintext Password Deprecation\n";
echo " Mode: {$modeLabel}\n";
echo " Timestamp: " . date('Y-m-d H:i:s T') . "\n";
echo "====================================================================\n\n";

$companies = get_registered_companies();
$totalScanned = 0;
$totalWithPlain = 0;
$totalHashesFixed = 0;
$totalMigrated = 0;

foreach ($companies as $company) {
    $dbName = $company['db_name'] ?? 'hrms';
    $compName = $company['name'] ?? $dbName;
    echo "Processing Company: '{$compName}' [Database: {$dbName}]...\n";

    set_active_db_name($dbName);
    $employeesCol = collection('employees', $dbName);

    try {
        // Find employees with plain_password field present
        $cursor = $employeesCol->find([
            'plain_password' => ['$exists' => true]
        ]);

        $companyPlainCount = 0;
        $companyHashesFixed = 0;
        $companyMigrated = 0;

        foreach ($cursor as $doc) {
            $companyPlainCount++;
            $totalWithPlain++;
            $docId = (string)($doc['_id'] ?? '');
            $empCode = (string)($doc['employee_code'] ?? 'N/A');

            $existingHash = (string)($doc['password'] ?? '');
            $plainValue = (string)($doc['plain_password'] ?? '');

            $hashInfo = password_get_info($existingHash);
            $hasValidHash = !empty($hashInfo['algo']);

            $updateOperations = [];
            $setFields = [];
            $unsetFields = [
                'plain_password' => '',
                'current_password' => '',
            ];

            // If existing password hash is invalid or missing, safely generate a secure hash from plain_password
            if (!$hasValidHash && $plainValue !== '') {
                $newHash = password_hash($plainValue, PASSWORD_DEFAULT);
                $setFields['password'] = $newHash;
                $setFields['updated_at'] = new MongoDB\BSON\UTCDateTime();
                $companyHashesFixed++;
                $totalHashesFixed++;
            }

            if (!empty($setFields)) {
                $updateOperations['$set'] = $setFields;
            }
            $updateOperations['$unset'] = $unsetFields;

            if ($isExecute) {
                $employeesCol->updateOne(['_id' => $doc['_id']], $updateOperations);
                $companyMigrated++;
                $totalMigrated++;
            }
        }

        echo "  - Identified {$companyPlainCount} employee records containing legacy plaintext passwords.\n";
        if ($companyHashesFixed > 0) {
            echo "  - Re-hashed {$companyHashesFixed} missing or invalid password hashes.\n";
        }
        if ($isExecute) {
            echo "  - Successfully sanitized {$companyMigrated} records (unset plain_password & current_password).\n";
        } else {
            echo "  - Dry run: {$companyPlainCount} records would be sanitized.\n";
        }
        echo "\n";

    } catch (Throwable $e) {
        echo "  [ERROR] Failed to query database '{$dbName}': " . $e->getMessage() . "\n\n";
    }
}

echo "====================================================================\n";
echo " Migration Summary:\n";
echo " Total records with plaintext passwords identified : {$totalWithPlain}\n";
echo " Total hashes repaired                              : {$totalHashesFixed}\n";
if ($isExecute) {
    echo " Total records safely migrated in database          : {$totalMigrated}\n";
    echo " Status: COMPLETED SUCCESSFULLY\n";
} else {
    echo " Status: DRY-RUN COMPLETED (To apply changes, run with --execute)\n";
}
echo "====================================================================\n";
