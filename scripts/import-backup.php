<?php
declare(strict_types=1);

require_once __DIR__ . '/config/bootstrap.php';

// ─── Helper: convert Extended JSON types to BSON ────────────────────────────
function convertValue(mixed $value): mixed
{
    if (is_array($value)) {
        // {"$oid": "..."} → ObjectId
        if (isset($value['$oid']) && count($value) === 1) {
            return new MongoDB\BSON\ObjectId($value['$oid']);
        }
        // {"$date": "ISO string"} or {"$date": {"$numberLong": "..."}} → UTCDateTime
        if (isset($value['$date']) && count($value) === 1) {
            $d = $value['$date'];
            if (is_string($d)) {
                $ts = (int)(strtotime($d) * 1000);
            } elseif (is_array($d) && isset($d['$numberLong'])) {
                $ts = (int)$d['$numberLong'];
            } else {
                $ts = (int)$d;
            }
            return new MongoDB\BSON\UTCDateTime($ts);
        }
        // {"$numberLong": "..."} → int
        if (isset($value['$numberLong']) && count($value) === 1) {
            return (int)$value['$numberLong'];
        }
        // Recurse into arrays / objects
        $out = [];
        foreach ($value as $k => $v) {
            $out[$k] = convertValue($v);
        }
        return $out;
    }
    return $value;
}

// ─── Main import ─────────────────────────────────────────────────────────────
$backupDir = dirname(__DIR__) . '/latest-backup';
$files = glob($backupDir . '/*.json');

if (empty($files)) {
    echo "❌ No JSON files found in latest-backup/\n";
    exit(1);
}

$totalInserted = 0;
$totalSkipped  = 0;

foreach ($files as $file) {
    $collectionName = pathinfo($file, PATHINFO_FILENAME);
    $raw = file_get_contents($file);
    $docs = json_decode($raw, true);

    if (!is_array($docs) || count($docs) === 0) {
        echo "⏭  $collectionName — empty or invalid JSON, skipping.\n";
        continue;
    }

    $col = collection($collectionName);
    $inserted = 0;
    $skipped  = 0;

    foreach ($docs as $doc) {
        $doc = convertValue($doc);

        // Skip if _id already exists (avoids duplicates on re-run)
        if (isset($doc['_id'])) {
            $existing = $col->findOne(['_id' => $doc['_id']]);
            if ($existing) {
                $skipped++;
                continue;
            }
        }

        try {
            $col->insertOne($doc);
            $inserted++;
        } catch (Exception $e) {
            echo "  ⚠  $collectionName — skipping doc: " . $e->getMessage() . "\n";
            $skipped++;
        }
    }

    echo "✅ $collectionName — inserted: $inserted, skipped (already exist): $skipped\n";
    $totalInserted += $inserted;
    $totalSkipped  += $skipped;
}

echo "\n";
echo "════════════════════════════════════\n";
echo "✅ Import complete!\n";
echo "   Total inserted : $totalInserted\n";
echo "   Total skipped  : $totalSkipped\n";
echo "════════════════════════════════════\n";
