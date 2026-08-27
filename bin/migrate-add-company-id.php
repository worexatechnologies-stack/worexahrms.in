<?php
/**
 * One-time single-tenant to multi-tenant data migration.
 *
 * Preview (default):
 *   php bin/migrate-add-company-id.php --dry-run
 *
 * Apply after reviewing the preview:
 *   php bin/migrate-add-company-id.php --confirm
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo json_encode(['error' => 'CLI only']);
    exit(1);
}

$options = getopt('', ['dry-run', 'confirm', 'name:', 'slug:', 'help']);

if (isset($options['help'])) {
    echo <<<'USAGE'
Usage:
  php bin/migrate-add-company-id.php [--dry-run] [--confirm]
      [--name="Company #1"] [--slug="company-1"]

The script defaults to a read-only dry run. Pass --confirm to create the
company, backfill missing/string tenant ids, and create indexes. It refuses to
overwrite a non-empty company_id belonging to a different company.

USAGE;
    exit(0);
}

$isDryRun = isset($options['dry-run']) || !isset($options['confirm']);
$isConfirmed = isset($options['confirm']);
if ($isDryRun && $isConfirmed) {
    fwrite(STDERR, "Choose either --dry-run or --confirm, not both.\n");
    exit(2);
}

$companyName = trim((string)($options['name'] ?? 'Company #1'));
$companySlug = strtolower(trim((string)($options['slug'] ?? 'company-1')));

if ($companyName === '' || strlen($companyName) > 120) {
    fwrite(STDERR, "Company name must contain 1 to 120 characters.\n");
    exit(2);
}
if (!preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $companySlug)) {
    fwrite(STDERR, "Company slug must be 1-63 lowercase letters, numbers, or hyphens.\n");
    exit(2);
}

require_once __DIR__ . '/../api/config/bootstrap.php';
require_once __DIR__ . '/../api/config/mongodb-helpers.php';

$companies = collection('companies');
$existingCompany = $companies->findOne(['slug' => $companySlug]);
$companyId = $existingCompany
    ? $existingCompany['_id']
    : new MongoDB\BSON\ObjectId();

if (!$companyId instanceof MongoDB\BSON\ObjectId) {
    fwrite(STDERR, "The existing company has an invalid _id; migration stopped.\n");
    exit(1);
}

$missingFilter = [
    '$or' => [
        ['company_id' => ['$exists' => false]],
        ['company_id' => null],
        ['company_id' => ''],
    ],
];
$stringIdFilter = ['company_id' => (string)$companyId];
$conflictingFilter = [
    'company_id' => [
        '$exists' => true,
        '$nin' => [null, '', $companyId, (string)$companyId],
    ],
];

echo PHP_EOL . '=== Add company_id migration (' . ($isDryRun ? 'DRY RUN' : 'CONFIRMED') . ') ===' . PHP_EOL;
echo 'Company: ' . $companyName . ' (' . $companySlug . ')' . PHP_EOL;
echo 'Company ObjectId: ' . (string)$companyId . PHP_EOL . PHP_EOL;

/** @var array<string, array{missing: int, stringId: int, conflicts: int, total: int}> $preflight */
$preflight = [];
$hasConflicts = false;

foreach (tenantScopedCollectionNames() as $collectionName) {
    $tenantCollection = collection($collectionName);
    $total = $tenantCollection->countDocuments();
    $missing = $tenantCollection->countDocuments($missingFilter);
    $stringId = $tenantCollection->countDocuments($stringIdFilter);
    $conflicts = $tenantCollection->countDocuments($conflictingFilter);
    $preflight[$collectionName] = compact('missing', 'stringId', 'conflicts', 'total');
    $hasConflicts = $hasConflicts || $conflicts > 0;

    printf(
        "%-24s total=%-7d backfill=%-7d normalize=%-7d conflicts=%d\n",
        $collectionName,
        $total,
        $missing,
        $stringId,
        $conflicts
    );
}

if ($hasConflicts) {
    fwrite(
        STDERR,
        "\nMigration stopped: at least one document has a different non-empty company_id. "
        . "Resolve those records explicitly; this script will not overwrite tenant ownership.\n"
    );
    exit(1);
}

if ($isDryRun) {
    echo PHP_EOL;
    echo $existingCompany
        ? "Company record already exists; no company insert would be needed.\n"
        : "One generic Company #1 record would be created.\n";
    echo "No data or indexes were changed. Re-run with --confirm after reviewing this output.\n";
    exit(0);
}

// Create the global indexes first. A duplicate slug failure stops the run
// before tenant documents are changed.
$companies->createIndex(['slug' => 1], [
    'unique' => true,
    'name' => 'uidx_companies_slug',
]);
$companies->createIndex(['status' => 1], [
    'name' => 'idx_companies_status',
]);

if (!$existingCompany) {
    $companies->insertOne([
        '_id' => $companyId,
        'name' => $companyName,
        'slug' => $companySlug,
        'status' => 'active',
        'plan_id' => null,
        'created_at' => new MongoDB\BSON\UTCDateTime((int)(microtime(true) * 1000)),
    ]);
    echo PHP_EOL . "Created Company #1.\n";
} else {
    echo PHP_EOL . "Reusing existing company record.\n";
}

foreach (tenantScopedCollectionNames() as $collectionName) {
    $tenantCollection = collection($collectionName);
    $missingResult = $tenantCollection->updateMany(
        $missingFilter,
        ['$set' => ['company_id' => $companyId]]
    );
    $stringResult = $tenantCollection->updateMany(
        $stringIdFilter,
        ['$set' => ['company_id' => $companyId]]
    );
    $tenantCollection->createIndex(['company_id' => 1], [
        'name' => 'idx_company_id',
    ]);

    printf(
        "%-24s backfilled=%-7d normalized=%-7d index=idx_company_id\n",
        $collectionName,
        $missingResult->getModifiedCount(),
        $stringResult->getModifiedCount()
    );
}

echo PHP_EOL . "Migration complete. Re-running --confirm is safe and should modify zero documents.\n";
echo "Next, run php scripts/setup-indexes.php to install tenant compound indexes and replace legacy global unique indexes.\n";
