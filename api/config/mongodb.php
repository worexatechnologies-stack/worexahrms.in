<?php
declare(strict_types=1);

function mongodb(): MongoDB\Client
{
    static $client = null;

    if ($client instanceof MongoDB\Client) {
        return $client;
    }

    $uri = getenv('MONGODB_URI') ?: 'mongodb+srv://ullasgowdaworexa_db_user:CKNINKHTuKzoZbRM@cluster0.4ptj6i3.mongodb.net';
    $dbName = getenv('MONGODB_DB_NAME') ?: 'hrms';

    if (!extension_loaded('mongodb')) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'message' => 'Database service is unavailable. Please contact support.',
            'data' => null,
        ]);
        exit;
    }

    try {
        $client = new MongoDB\Client($uri, [
            'serverSelectionTimeoutMS' => 5000,
            'connectTimeoutMS' => 5000,
        ]);
        
        // Test connection
        $client->selectDatabase($dbName)->command(['ping' => 1]);
        
    } catch (MongoDB\Driver\Exception\Exception $e) {
        $msg = match (true) {
            str_contains($e->getMessage(), 'Timeout') => 'Database timeout. Please try again shortly.',
            default => 'Database service is unavailable. Please try again shortly.',
        };

        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'message' => $msg, 'data' => null]);
        exit;
    }

    return $client;
}

/**
 * Resolve current active company database name dynamically.
 * Prioritizes explicitly set active DB (e.g. during login search),
 * then decoded JWT claims from the authenticated user,
 * then falls back to MONGODB_DB_NAME or 'hrms'.
 */
function get_active_db_name(): string
{
    if (!empty($GLOBALS['_HRMS_ACTIVE_DB_NAME'])) {
        return (string)$GLOBALS['_HRMS_ACTIVE_DB_NAME'];
    }

    if (function_exists('bearer_token') && function_exists('decode_token')) {
        $token = bearer_token();
        if ($token) {
            $claims = decode_token($token);
            if (!empty($claims['company_db'])) {
                $clean = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$claims['company_db']);
                if ($clean !== '') {
                    $GLOBALS['_HRMS_ACTIVE_DB_NAME'] = $clean;
                    return $clean;
                }
            }
        }
    }

    $default = getenv('MONGODB_DB_NAME') ?: 'hrms';
    return $default;
}

function set_active_db_name(string $dbName): void
{
    $clean = preg_replace('/[^a-zA-Z0-9_-]/', '', $dbName);
    if ($clean !== '') {
        $GLOBALS['_HRMS_ACTIVE_DB_NAME'] = $clean;
    }
}

/**
 * Get registered companies list from master hrms.companies collection.
 */
function get_registered_companies(): array
{
    static $cachedCompanies = null;
    if ($cachedCompanies !== null) {
        return $cachedCompanies;
    }

    $defaultMasterDb = getenv('MONGODB_DB_NAME') ?: 'hrms';
    try {
        $masterDb = mongodb()->selectDatabase($defaultMasterDb);
        $docs = $masterDb->selectCollection('companies')->find(['active' => ['$ne' => false]])->toArray();
        if (!empty($docs)) {
            $cachedCompanies = [];
            foreach ($docs as $d) {
                $cachedCompanies[] = [
                    'name' => (string)($d['name'] ?? 'Company'),
                    'slug' => (string)($d['slug'] ?? 'company'),
                    'db_name' => (string)($d['db_name'] ?? 'hrms'),
                ];
            }
            return $cachedCompanies;
        }
    } catch (Throwable $e) {}

    $cachedCompanies = [
        ['name' => 'Worexa', 'slug' => 'worexa', 'db_name' => 'hrms'],
        ['name' => 'Viyana Production', 'slug' => 'viyana', 'db_name' => 'hrms_viyana'],
    ];
    return $cachedCompanies;
}

/**
 * Get a MongoDB database instance
 */
function db(?string $specificDbName = null): MongoDB\Database
{
    static $databases = [];
    $name = $specificDbName ?: get_active_db_name();
    if (!isset($databases[$name])) {
        $databases[$name] = mongodb()->selectDatabase($name);
    }
    return $databases[$name];
}

/**
 * Get a collection from MongoDB
 */
function collection(string $name, ?string $specificDbName = null): MongoDB\Collection
{
    return db($specificDbName)->selectCollection($name);
}
