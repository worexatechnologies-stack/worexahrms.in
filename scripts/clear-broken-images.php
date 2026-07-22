<?php
declare(strict_types=1);
require_once __DIR__ . '/../api/config/bootstrap.php';
require_once __DIR__ . '/../api/config/mongodb-helpers.php';

$employees = collection('employees');
$docs = findMany($employees, []);
$cleared = 0;

foreach ($docs as $emp) {
    $img = (string)($emp['profile_image'] ?? '');
    if ($img === '' || $img === 'null') continue;
    if (str_starts_with($img, 'data:')) continue; // base64 — fine

    // It's a file path — check if it exists on disk
    $path = __DIR__ . '/../api/' . ltrim($img, '/\\');
    if (!file_exists($path)) {
        updateOne($employees, ['_id' => $emp['_id']], ['profile_image' => null]);
        echo "Cleared broken path for: " . ($emp['name'] ?? '?') . " → $img\n";
        $cleared++;
    }
}

echo "\nDone. Cleared $cleared broken image paths.\n";
