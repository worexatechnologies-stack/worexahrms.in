<?php
declare(strict_types=1);
require_once __DIR__ . '/../api/config/bootstrap.php';
require_once __DIR__ . '/../api/config/mongodb-helpers.php';

function scanCollection(string $colName): void
{
    echo "========================================\n";
    echo "🔍 Scanning collection: $colName\n";
    echo "========================================\n";

    $col = collection($colName);
    $docs = findMany($col, []);
    $total = count($docs);
    $base64Count = 0;
    $filePathValid = 0;
    $emptyCount = 0;
    $clearedCount = 0;

    foreach ($docs as $doc) {
        $img = (string)($doc['profile_image'] ?? '');
        $name = $doc['name'] ?? ($doc['email'] ?? 'Unknown');

        if ($img === '' || $img === 'null') {
            $emptyCount++;
            continue;
        }

        if (str_starts_with($img, 'data:')) {
            $base64Count++;
            continue;
        }

        // It's a file path — check if it exists in api/ or uploads/
        $cleanPath = ltrim($img, '/\\');
        $path1 = __DIR__ . '/../api/' . $cleanPath;
        $path2 = __DIR__ . '/../api/uploads/' . basename($cleanPath);

        if (file_exists($path1) || file_exists($path2)) {
            $filePathValid++;
        } else {
            updateOne($col, ['_id' => $doc['_id']], ['profile_image' => null]);
            echo "❌ Cleared broken image for: $name → $img\n";
            $clearedCount++;
        }
    }

    echo "Total records scanned  : $total\n";
    echo "Valid Base64 images    : $base64Count\n";
    echo "Valid file images      : $filePathValid\n";
    echo "No image (placeholder) : $emptyCount\n";
    echo "Broken images cleared  : $clearedCount\n\n";
}

scanCollection('employees');
scanCollection('users');

echo "✅ Scan complete!\n";
