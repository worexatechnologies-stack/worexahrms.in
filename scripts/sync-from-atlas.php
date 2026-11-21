<?php
declare(strict_types=1);

/**
 * Sync all production data and indexes from MongoDB Atlas to Local MongoDB.
 * 
 * Safe operation: Reads ONLY from Atlas (production).
 * Overwrites/populates local MongoDB collections with fresh production data.
 */

$ATLAS_URI = getenv('ATLAS_URI') ?: 'mongodb+srv://ullasgowdaworexa_db_user:CKNINKHTuKzoZbRM@cluster0.4ptj6i3.mongodb.net';
$LOCAL_URI = getenv('LOCAL_URI') ?: 'mongodb://127.0.0.1:27017/';

if (!extension_loaded('mongodb')) {
    echo "❌ MongoDB PHP extension not loaded.\n";
    exit(1);
}

$autoloadPaths = [
    __DIR__ . '/../api/vendor/autoload.php',
    __DIR__ . '/vendor/autoload.php',
];

$autoloadFound = false;
foreach ($autoloadPaths as $path) {
    if (file_exists($path)) {
        require_once $path;
        $autoloadFound = true;
        break;
    }
}

if (!$autoloadFound) {
    echo "❌ Composer autoload not found.\n";
    exit(1);
}

echo "════════════════════════════════════════════════════════════\n";
echo "🔄 HRMS Database Sync: Atlas (Production) ➔ Local MongoDB\n";
echo "════════════════════════════════════════════════════════════\n\n";

try {
    echo "🔌 Connecting to Production Atlas...\n";
    $atlas = new MongoDB\Client($ATLAS_URI, [
        'serverSelectionTimeoutMS' => 10000,
        'connectTimeoutMS'         => 10000,
    ]);
    // Ping to verify connection
    $atlas->selectDatabase('admin')->command(['ping' => 1]);
    echo "✅ Connected to Production Atlas.\n\n";
} catch (Throwable $e) {
    echo "❌ Failed to connect to Production Atlas: " . $e->getMessage() . "\n";
    exit(1);
}

try {
    echo "🔌 Connecting to Local MongoDB ($LOCAL_URI)...\n";
    $local = new MongoDB\Client($LOCAL_URI, [
        'serverSelectionTimeoutMS' => 5000,
        'connectTimeoutMS'         => 5000,
    ]);
    $local->selectDatabase('admin')->command(['ping' => 1]);
    echo "✅ Connected to Local MongoDB.\n\n";
} catch (Throwable $e) {
    echo "❌ Failed to connect to Local MongoDB: " . $e->getMessage() . "\n";
    echo "💡 Ensure MongoDB service is running locally (`net start MongoDB` or check Services).\n";
    exit(1);
}

// Find non-system databases in Atlas
$databasesToSync = [];
foreach ($atlas->listDatabases() as $dbInfo) {
    $dbName = $dbInfo->getName();
    if (!in_array($dbName, ['admin', 'config', 'local'], true)) {
        $databasesToSync[] = $dbName;
    }
}

if (empty($databasesToSync)) {
    // Fallback to default HRMS databases
    $databasesToSync = ['hrms', 'hrms_viyana'];
}

echo "📋 Target Databases to Sync: " . implode(', ', $databasesToSync) . "\n\n";

$grandTotalDocs = 0;
$grandTotalIndexes = 0;

foreach ($databasesToSync as $dbName) {
    echo "────────────────────────────────────────────────────────────\n";
    echo "📂 Processing Database: $dbName\n";
    echo "────────────────────────────────────────────────────────────\n";

    $atlasDb = $atlas->selectDatabase($dbName);
    $localDb = $local->selectDatabase($dbName);

    $collections = [];
    foreach ($atlasDb->listCollections() as $colInfo) {
        $colName = $colInfo->getName();
        if (!str_starts_with($colName, 'system.')) {
            $collections[] = $colName;
        }
    }

    if (empty($collections)) {
        echo "ℹ️  No collections found in $dbName.\n";
        continue;
    }

    sort($collections);
    echo "Found " . count($collections) . " collections in '$dbName'.\n\n";

    $dbTotalDocs = 0;

    foreach ($collections as $colName) {
        $srcCol  = $atlasDb->selectCollection($colName);
        $destCol = $localDb->selectCollection($colName);

        // Count source documents
        $srcCount = $srcCol->countDocuments();

        // Recreate local collection
        try {
            $destCol->drop();
        } catch (Throwable $e) {
            // Ignore if doesn't exist
        }

        $insertedCount = 0;

        if ($srcCount > 0) {
            $cursor = $srcCol->find([], [
                'typeMap' => [
                    'root' => 'array',
                    'document' => 'array',
                    'array' => 'array',
                ],
            ]);

            $batchSize = 500;
            $batch = [];

            foreach ($cursor as $doc) {
                $batch[] = $doc;
                if (count($batch) >= $batchSize) {
                    $destCol->insertMany($batch);
                    $insertedCount += count($batch);
                    $batch = [];
                }
            }

            if (!empty($batch)) {
                $destCol->insertMany($batch);
                $insertedCount += count($batch);
            }
        }

        // Replicate indexes from Atlas
        $indexCount = 0;
        try {
            $indexes = $srcCol->listIndexes();
            foreach ($indexes as $idx) {
                if ($idx->getName() === '_id_') {
                    continue; // Primary key index is created automatically
                }

                $key = $idx->getKey();
                $options = ['name' => $idx->getName()];

                if ($idx->isUnique()) {
                    $options['unique'] = true;
                }
                if ($idx->isSparse()) {
                    $options['sparse'] = true;
                }
                $expireAfter = $idx['expireAfterSeconds'] ?? null;
                if ($expireAfter !== null) {
                    $options['expireAfterSeconds'] = (int)$expireAfter;
                }

                try {
                    $destCol->createIndex($key, $options);
                    $indexCount++;
                    $grandTotalIndexes++;
                } catch (Throwable $ie) {
                    echo "   ⚠️  Index failed for {$colName}.{$idx->getName()}: " . $ie->getMessage() . "\n";
                }
            }
        } catch (Throwable $e) {
            echo "   ⚠️  Could not read indexes for $colName: " . $e->getMessage() . "\n";
        }

        echo sprintf("  ✅ %-22s : %5d docs synced, %2d index(es)\n", $colName, $insertedCount, $indexCount);
        $dbTotalDocs += $insertedCount;
    }

    echo "\n  Subtotal for $dbName: $dbTotalDocs documents.\n\n";
    $grandTotalDocs += $dbTotalDocs;
}

// Remove test-mongo.php if present
$testScript = __DIR__ . '/test-mongo.php';
if (file_exists($testScript)) {
    @unlink($testScript);
}

echo "════════════════════════════════════════════════════════════\n";
echo "🎉 SYNC COMPLETE: Production ➔ Local MongoDB\n";
echo "   Total Databases Synced : " . count($databasesToSync) . "\n";
echo "   Total Documents Synced : " . $grandTotalDocs . "\n";
echo "   Total Indexes Created  : " . $grandTotalIndexes . "\n";
echo "   ⚠️  Production database was NOT modified (read-only).\n";
echo "════════════════════════════════════════════════════════════\n";
