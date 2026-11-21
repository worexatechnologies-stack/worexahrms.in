<?php
declare(strict_types=1);

/**
 * Lightweight MongoDB-backed Task Queue for HRMS
 *
 * Implements atomic job leasing, retry tracking, exponential backoff,
 * and dead-letter failure handling without external infrastructure (no Redis / RabbitMQ required).
 */

require_once __DIR__ . '/mongodb-helpers.php';

/**
 * Dispatch a job to the background queue.
 */
function queue_dispatch(
    string $type,
    array $payload = [],
    int $delaySeconds = 0,
    string $queue = 'default',
    ?string $specificDb = null
): string {
    $now = time();
    $availableAt = $now + max(0, $delaySeconds);

    $job = [
        'queue'        => $queue,
        'type'         => $type,
        'payload'      => $payload,
        'status'       => 'pending',
        'attempts'     => 0,
        'max_attempts' => 3,
        'available_at' => new MongoDB\BSON\UTCDateTime($availableAt * 1000),
        'created_at'   => new MongoDB\BSON\UTCDateTime($now * 1000),
        'updated_at'   => new MongoDB\BSON\UTCDateTime($now * 1000),
        'locked_at'    => null,
        'error'        => null,
    ];

    $jobsCol = collection('jobs', $specificDb);
    $result = $jobsCol->insertOne($job);
    return (string)$result->getInsertedId();
}

/**
 * Atomically reserve the next pending job from the queue.
 */
function queue_reserve(string $queue = 'default', int $lockTimeoutSec = 120, ?string $specificDb = null): ?array
{
    $jobsCol = collection('jobs', $specificDb);
    $nowUtc = new MongoDB\BSON\UTCDateTime();
    $staleLockThreshold = new MongoDB\BSON\UTCDateTime((time() - $lockTimeoutSec) * 1000);

    // Step 1: Reclaim expired / orphaned leases from crashed workers
    try {
        $jobsCol->updateMany(
            [
                'queue'     => $queue,
                'status'    => 'processing',
                'locked_at' => ['$lt' => $staleLockThreshold],
                'attempts'  => ['$lt' => 3],
            ],
            [
                '$set' => [
                    'status'     => 'pending',
                    'updated_at' => $nowUtc,
                ],
            ]
        );
    } catch (Throwable $e) {
        // Non-fatal
    }

    // Step 2: Atomically lease next available pending job
    try {
        $doc = $jobsCol->findOneAndUpdate(
            [
                'queue'        => $queue,
                'status'       => 'pending',
                'available_at' => ['$lte' => $nowUtc],
                'attempts'     => ['$lt' => 3],
            ],
            [
                '$set' => [
                    'status'     => 'processing',
                    'locked_at'  => $nowUtc,
                    'updated_at' => $nowUtc,
                ],
                '$inc' => [
                    'attempts' => 1,
                ],
            ],
            [
                'sort' => ['created_at' => 1],
                'returnDocument' => MongoDB\Operation\FindOneAndUpdate::RETURN_DOCUMENT_AFTER,
            ]
        );

        if (!$doc) {
            return null;
        }

        return (array)$doc;
    } catch (Throwable $e) {
        error_log('[HRMS QUEUE ERROR] Failed to reserve job: ' . $e->getMessage());
        return null;
    }
}

/**
 * Mark a job as completed.
 */
function queue_complete(string|MongoDB\BSON\ObjectId $jobId, ?string $specificDb = null): void
{
    $jobsCol = collection('jobs', $specificDb);
    $id = is_string($jobId) ? mongoId($jobId) : $jobId;

    $jobsCol->updateOne(
        ['_id' => $id],
        [
            '$set' => [
                'status'       => 'completed',
                'completed_at' => new MongoDB\BSON\UTCDateTime(),
                'updated_at'   => new MongoDB\BSON\UTCDateTime(),
            ],
        ]
    );
}

/**
 * Mark a job as failed, recording error and scheduling backoff retry if attempts remain.
 */
function queue_fail(string|MongoDB\BSON\ObjectId $jobId, string $errorMessage, ?string $specificDb = null): void
{
    $jobsCol = collection('jobs', $specificDb);
    $id = is_string($jobId) ? mongoId($jobId) : $jobId;

    $job = $jobsCol->findOne(['_id' => $id]);
    $attempts = (int)($job['attempts'] ?? 1);
    $maxAttempts = (int)($job['max_attempts'] ?? 3);

    $isDead = ($attempts >= $maxAttempts);
    $status = $isDead ? 'failed' : 'pending';

    // Exponential backoff: 30s, 120s, 300s
    $backoffSec = match ($attempts) {
        1 => 30,
        2 => 120,
        default => 300,
    };
    $retryAvailableAt = new MongoDB\BSON\UTCDateTime((time() + $backoffSec) * 1000);

    $jobsCol->updateOne(
        ['_id' => $id],
        [
            '$set' => [
                'status'       => $status,
                'error'        => substr($errorMessage, 0, 1000),
                'available_at' => $retryAvailableAt,
                'updated_at'   => new MongoDB\BSON\UTCDateTime(),
            ],
        ]
    );
}
