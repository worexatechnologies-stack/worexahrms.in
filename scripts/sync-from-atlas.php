<?php
declare(strict_types=1);

// ─── Config ─────────────────────────────────────────────────────────────────
$ATLAS_URI  = 'mongodb+srv://ullasgowdaworexa_db_user:CKNINKHTuKzoZbRM@cluster0.4ptj6i3.mongodb.net';
$LOCAL_URI  = 'mongodb://localhost:27017/';
$DB_NAME    = 'hrms';

if (!extension_loaded('mongodb')) {
    echo "❌ MongoDB PHP extension not loaded.\n";
    exit(1);
}

require_once __DIR__ . '/vendor/autoload.php';

// ─── Connect ─────────────────────────────────────────────────────────────────
echo "🔌 Connecting to Atlas (production)...\n";
$atlas = new MongoDB\Client($ATLAS_URI, [
    'serverSelectionTimeoutMS' => 10000,
    'connectTimeoutMS'         => 10000,
]);
$atlasDb = $atlas->selectDatabase($DB_NAME);
echo "✅ Connected to Atlas.\n\n";

echo "🔌 Connecting to Local MongoDB...\n";
$local = new MongoDB\Client($LOCAL_URI, [
    'serverSelectionTimeoutMS' => 5000,
    'connectTimeoutMS'         => 5000,
]);
$localDb = $local->selectDatabase($DB_NAME);
echo "✅ Connected to Local MongoDB.\n\n";

// ─── Get all collection names from Atlas ────────────────────────────────────
$collections = [];
foreach ($atlasDb->listCollections() as $col) {
    $collections[] = $col->getName();
}

if (empty($collections)) {
    echo "❌ No collections found in Atlas DB '$DB_NAME'.\n";
    exit(1);
}

echo "📦 Found " . count($collections) . " collections: " . implode(', ', $collections) . "\n\n";

// ─── Sync each collection ───────────────────────────────────────────────────
$totalInserted = 0;
$totalUpdated  = 0;

foreach ($collections as $colName) {
    $sourceCol = $atlasDb->selectCollection($colName);
    $destCol   = $localDb->selectCollection($colName);

    $docs = $sourceCol->find([], ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']]);

    $inserted = 0;
    $updated  = 0;

    foreach ($docs as $doc) {
        $id = $doc['_id'] ?? null;

        if ($id !== null) {
            // Upsert: update if exists, insert if not
            $result = $destCol->replaceOne(
                ['_id' => $id],
                $doc,
                ['upsert' => true]
            );
            if ($result->getUpsertedCount() > 0) {
                $inserted++;
            } else {
                $updated++;
            }
        } else {
            $destCol->insertOne($doc);
            $inserted++;
        }
    }

    $total = $inserted + $updated;
    echo "✅ $colName — $total docs (new: $inserted, updated: $updated)\n";
    $totalInserted += $inserted;
    $totalUpdated  += $updated;
}

echo "\n";
echo "════════════════════════════════════════\n";
echo "🎉 Sync complete! Production → Local\n";
echo "   New docs    : $totalInserted\n";
echo "   Updated docs: $totalUpdated\n";
echo "   Total synced: " . ($totalInserted + $totalUpdated) . "\n";
echo "   ⚠️  Production was NOT modified.\n";
echo "════════════════════════════════════════\n";
