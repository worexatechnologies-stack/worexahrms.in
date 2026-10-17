<?php
/**
 * Migrate old file-path profile images into MongoDB as base64 data URIs.
 *
 * Finds every employee whose profile_image is a file path (e.g. "uploads/emp_xxx.png")
 * rather than a data URI, reads the file, compresses it with GD, stores the base64
 * directly in the document, and optionally deletes the old file.
 *
 * Run from the project root:
 *   php scripts/migrate-images-to-db.php
 *
 * Options (set as env vars or edit below):
 *   DELETE_FILES=1  — delete old image files after migrating (default: 0)
 */

declare(strict_types=1);
require_once __DIR__ . '/../api/config/bootstrap.php';
require_once __DIR__ . '/../api/config/mongodb-helpers.php';

$deleteFiles = (getenv('DELETE_FILES') === '1');
$apiDir      = __DIR__ . '/../api';

echo "=== Migrate Profile Images to MongoDB ===\n\n";
echo "GD loaded : " . (extension_loaded('gd') ? 'YES' : 'NO') . "\n";
echo "Delete files after migration: " . ($deleteFiles ? 'YES' : 'NO') . "\n\n";

$employees  = collection('employees');
$cursor     = findMany($employees, [], []);
$total      = 0;
$migrated   = 0;
$skipped    = 0;
$failed     = 0;
$alreadyDb  = 0;

foreach ($cursor as $emp) {
    $total++;
    $empId = (string)($emp['_id'] ?? '');
    $name  = (string)($emp['name'] ?? $empId);
    $img   = (string)($emp['profile_image'] ?? '');

    // Already stored as base64 data URI — nothing to do
    if (str_starts_with($img, 'data:')) {
        $alreadyDb++;
        echo "  [SKIP]  $name — already base64\n";
        continue;
    }

    // No image at all
    if ($img === '' || $img === 'null') {
        $skipped++;
        echo "  [SKIP]  $name — no image\n";
        continue;
    }

    // It's a file path — resolve to absolute path
    $filePath = realpath($apiDir . '/' . ltrim($img, '/\\'));
    if (!$filePath || !file_exists($filePath)) {
        $failed++;
        echo "  [FAIL]  $name — file not found: $img\n";
        // Clear the broken path so the avatar fallback shows initials
        updateOne($employees, ['_id' => $emp['_id']], ['profile_image' => null]);
        continue;
    }

    // Compress and convert
    $base64 = compressFileToBase64($filePath);
    if ($base64 === null) {
        $failed++;
        echo "  [FAIL]  $name — could not process image: $filePath\n";
        continue;
    }

    updateOne($employees, ['_id' => $emp['_id']], ['profile_image' => $base64]);
    $migrated++;

    $kb = round(strlen($base64) / 1024, 1);
    echo "  [OK]    $name — saved {$kb} KB base64\n";

    if ($deleteFiles) {
        @unlink($filePath);
        echo "          (deleted $filePath)\n";
    }
}

echo "\n=== Done ===\n";
echo "Total      : $total\n";
echo "Migrated   : $migrated\n";
echo "Already DB : $alreadyDb\n";
echo "Skipped    : $skipped\n";
echo "Failed     : $failed\n";

// ─── Helper ──────────────────────────────────────────────────────────────────

function compressFileToBase64(string $filePath): ?string
{
    $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
    $mimeMap = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'png' => 'image/png',  'gif'  => 'image/gif',
        'webp'=> 'image/webp',
    ];

    if (!isset($mimeMap[$ext])) return null;

    // Path A: GD
    if (extension_loaded('gd') && function_exists('imagecreatefromjpeg')) {
        $img = match ($ext) {
            'png'  => @imagecreatefrompng($filePath),
            'gif'  => @imagecreatefromgif($filePath),
            'webp' => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($filePath) : false,
            default => @imagecreatefromjpeg($filePath),
        };

        if ($img) {
            $w = imagesx($img);
            $h = imagesy($img);
            $max = 300;

            if ($w > $max || $h > $max) {
                if ($w >= $h) { $nw = $max; $nh = (int)round($h * $max / $w); }
                else          { $nh = $max; $nw = (int)round($w * $max / $h); }

                $r = imagecreatetruecolor($nw, $nh);
                $white = imagecolorallocate($r, 255, 255, 255);
                imagefilledrectangle($r, 0, 0, $nw, $nh, $white);
                imagecopyresampled($r, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
                imagedestroy($img);
                $img = $r;
            }

            $target  = 95 * 1024;
            $quality = 85;
            $raw     = '';
            do {
                ob_start();
                imagejpeg($img, null, $quality);
                $raw = (string)ob_get_clean();
                $quality -= 10;
            } while (strlen($raw) > $target && $quality >= 20);

            imagedestroy($img);
            if ($raw !== '') return 'data:image/jpeg;base64,' . base64_encode($raw);
        }
    }

    // Path B: raw fallback (client-side already compressed, cap at 500KB)
    $raw = file_get_contents($filePath);
    if ($raw === false || strlen($raw) > 500 * 1024) return null;
    return "data:{$mimeMap[$ext]};base64," . base64_encode($raw);
}
