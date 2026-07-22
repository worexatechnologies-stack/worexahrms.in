<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$user = current_user();
$data = input();
$id   = id_param();

/* ─── GET all holidays ────────────────────────────────────────────── */
if (method() === 'GET') {
    header('Cache-Control: public, max-age=86400'); // Cache for 24 hours
    $holidays = findMany(collection('holidays'), []);
    foreach ($holidays as &$h) {
        $h['id'] = (string) $h['_id'];
        if (!isset($h['title']) && isset($h['name'])) {
            $h['title'] = $h['name'];
        }
        // Handle UTCDateTime objects
        if ($h['date'] instanceof MongoDB\BSON\UTCDateTime) {
            $h['date'] = $h['date']->toDateTime()->format('Y-m-d');
        }
        // Handle BSONDocument with $date property (from JSON imports)
        elseif ($h['date'] instanceof MongoDB\Model\BSONDocument && isset($h['date']['$date'])) {
            try {
                $dt = new DateTime($h['date']['$date']);
                $h['date'] = $dt->format('Y-m-d');
            } catch (Exception) {
                $h['date'] = '';
            }
        }
        else {
            $h['date'] = (string)$h['date'];
        }
    }
    usort($holidays, function($a, $b) {
        return strcmp($a['date'] ?? '', $b['date'] ?? '');
    });
    ok(sanitizeForJson($holidays));
}

/* ─── POST create holiday (HR only) ──────────────────────────────── */
if (method() === 'POST') {
    if ($user['role'] !== 'hr') fail('Only HR can manage holidays.', 403);
    require_fields($data, ['title', 'date']);

    try {
        $result = insertOne(collection('holidays'), [
            'title'       => trim($data['title']),
            'date'        => $data['date'],
            'description' => !empty($data['description']) ? trim($data['description']) : null,
            'created_at'  => date('Y-m-d H:i:s'),
        ]);
    } catch (Exception $e) {
        if ($e->getCode() === 409) fail('A holiday on this date already exists.', 409);
        fail('Failed to create holiday.', 500);
    }

    ok(['id' => (string) $result['_id']], 'Holiday created.', 201);
}

/* ─── PUT update holiday (HR only) ───────────────────────────────── */
if (method() === 'PUT' && $id) {
    if ($user['role'] !== 'hr') fail('Only HR can manage holidays.', 403);

    $holiday = findOne(collection('holidays'), ['_id' => mongoId((string) $id)]);
    if (!$holiday) fail('Holiday not found.', 404);

    $update = [];
    foreach (['title', 'date', 'description'] as $f) {
        if (array_key_exists($f, $data)) {
            $update[$f] = $f === 'description' ? ($data[$f] ?? null) : trim((string) $data[$f]);
        }
    }
    if (!$update) fail('No fields to update.', 422);

    updateOne(collection('holidays'), ['_id' => mongoId((string) $id)], $update);
    ok(null, 'Holiday updated.');
}

/* ─── DELETE holiday (HR only) ───────────────────────────────────── */
if (method() === 'DELETE' && $id) {
    if ($user['role'] !== 'hr') fail('Only HR can manage holidays.', 403);
    $deleted = deleteOne(collection('holidays'), ['_id' => mongoId((string) $id)]);
    if (!$deleted) fail('Holiday not found.', 404);
    ok(null, 'Holiday deleted.');
}

fail('Method not allowed.', 405);
