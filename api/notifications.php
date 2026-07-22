<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$user = current_user();
rate_limit('notifications:' . method(), method() === 'GET' ? 90 : 30, 60, $user['id'] ?? '');
$data = input();

// Auto-cleanup: periodically hard-delete cleared notifications older than 7 days
// to prevent unbounded collection growth (runs ~1% of requests)
if (random_int(1, 100) === 1) {
    try {
        $cutoff = new MongoDB\BSON\UTCDateTime((time() - 7 * 86400) * 1000);
        collection('notifications')->deleteMany([
            'is_cleared' => true,
            'created_at' => ['$lt' => $cutoff],
        ]);
    } catch (Exception) {
        // silent
    }
}

/* ─── GET notifications ───────────────────────────────────────────── */
if (method() === 'GET') {
    // Summary mode: return unread count plus tiny event payloads after a client cursor.
    if (!empty($_GET['summary'])) {
        $unread = collection('notifications')->countDocuments([
            'user_id'    => $user['id'],
            'role'       => $user['role'],
            'is_cleared' => ['$ne' => true],
            'is_read'    => ['$ne' => true],
        ]);

        $eventBaseFilter = [
            'user_id'    => $user['id'],
            'role'       => $user['role'],
            'is_cleared' => ['$ne' => true],
            'event_id'   => ['$exists' => true],
        ];
        $latest = findMany(collection('notifications'), $eventBaseFilter, [
            'sort' => ['_id' => -1],
            'limit' => 1,
            'projection' => ['_id' => 1],
        ]);

        $events = [];
        $after = trim((string)($_GET['after'] ?? ''));
        if ($after !== '') {
            try {
                $eventFilter = $eventBaseFilter + ['_id' => ['$gt' => mongoId($after)]];
                $events = findMany(collection('notifications'), $eventFilter, [
                    'sort' => ['_id' => 1],
                    'limit' => 10,
                    'projection' => [
                        '_id' => 1,
                        'title' => 1,
                        'message' => 1,
                        'type' => 1,
                        'event_id' => 1,
                        'event_type' => 1,
                        'speak_text' => 1,
                        'visual_reason' => 1,
                        'created_at' => 1,
                    ],
                ]);
                $events = array_map('formatNotification', $events);
            } catch (Exception) {
                $events = [];
            }
        }

        $latestCursor = $latest[0]['_id'] ?? null;
        if ($events) {
            $last = $events[count($events) - 1];
            $latestCursor = $last['id'] ?? $latestCursor;
        }

        ok(sanitizeForJson([
            'unread_count' => (int) $unread,
            'latest_event_cursor' => $latestCursor ? (string)$latestCursor : '',
            'events' => $events,
        ]));
    }

    $limit = min(50, max(10, (int) ($_GET['limit'] ?? 30)));
    $filter = [
        'user_id'    => $user['id'],
        'role'       => $user['role'],
        'is_cleared' => ['$ne' => true],
    ];
    $notifs = findMany(collection('notifications'), $filter, [
        'sort'  => ['created_at' => -1],
        'limit' => $limit,
        'projection' => [
            '_id' => 1,
            'title' => 1,
            'message' => 1,
            'type' => 1,
            'event_id' => 1,
            'event_type' => 1,
            'speak_text' => 1,
            'visual_reason' => 1,
            'is_read' => 1,
            'created_at' => 1,
        ],
    ]);

    $notifs = array_map('formatNotification', $notifs);

    $unread = countDocs(collection('notifications'), $filter + ['is_read' => ['$ne' => true]]);
    ok(sanitizeForJson(['notifications' => $notifs, 'unread_count' => $unread]));
}

/* ─── PUT mark single as read ─────────────────────────────────────── */
if (method() === 'PUT' && isset($_GET['id'])) {
    updateOne(
        collection('notifications'),
        ['_id' => mongoId($_GET['id']), 'user_id' => $user['id']],
        ['is_read' => true]
    );
    ok(null, 'Notification marked as read.');
}

/* ─── PUT mark all as read ────────────────────────────────────────── */
if (method() === 'PUT' && isset($_GET['all'])) {
    collection('notifications')->updateMany(
        ['user_id' => $user['id'], 'role' => $user['role']],
        ['$set' => ['is_read' => true]]
    );
    ok(null, 'All notifications marked as read.');
}

/* ─── DELETE single ───────────────────────────────────────────────── */
if (method() === 'DELETE' && isset($_GET['id'])) {
    updateOne(collection('notifications'), [
        '_id'     => mongoId($_GET['id']),
        'user_id' => $user['id'],
        'role'    => $user['role'],
    ], [
        'is_cleared' => true
    ]);
    ok(null, 'Notification cleared.');
}

/* ─── DELETE all ──────────────────────────────────────────────────── */
if (method() === 'DELETE') {
    // Purge mode: permanently hard-delete old notifications across all users (HR only)
    if (!empty($_GET['purge'])) {
        if ($user['role'] !== 'hr') fail('Access denied.', 403);
        $days = (int)($_GET['days'] ?? 30);
        if ($days <= 0) {
            $deleted = collection('notifications')->deleteMany([]);
            ok(['deleted_count' => $deleted->getDeletedCount()], 'All notifications purged.');
        }
        $cutoff = new MongoDB\BSON\UTCDateTime((time() - $days * 86400) * 1000);
        $deleted = collection('notifications')->deleteMany([
            'created_at' => ['$lt' => $cutoff],
        ]);
        ok(['deleted_count' => $deleted->getDeletedCount()], "Purged notifications older than {$days} days.");
    }

    // Default: soft-delete all for current user
    collection('notifications')->updateMany([
        'user_id' => $user['id'],
        'role'    => $user['role'],
    ], [
        '$set' => ['is_cleared' => true]
    ]);
    ok(null, 'Notifications cleared.');
}

fail('Method not allowed.', 405);
