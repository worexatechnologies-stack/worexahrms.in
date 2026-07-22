<?php
declare(strict_types=1);

function mongodb(): MongoDB\Client
{
    static $client = null;

    if ($client instanceof MongoDB\Client) {
        return $client;
    }

    $uri = getenv('MONGODB_URI') ?: 'mongodb+srv://ullasgowdaworexa_db_user:ssMiu6YzQRsUZDRb@cluster0.4ptj6i3.mongodb.net';
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
 * Get a MongoDB database instance
 */
function db(): MongoDB\Database
{
    static $db = null;
    if ($db instanceof MongoDB\Database) {
        return $db;
    }
    
    $dbName = getenv('MONGODB_DB_NAME') ?: 'hrms';
    $db = mongodb()->selectDatabase($dbName);
    return $db;
}

/**
 * Get a collection from MongoDB
 */
function collection(string $name): MongoDB\Collection
{
    return db()->selectCollection($name);
}
