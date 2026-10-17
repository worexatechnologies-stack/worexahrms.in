<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo json_encode(['error' => 'CLI only']);
    exit;
}

require_once __DIR__ . '/../api/config/bootstrap.php';
require_once __DIR__ . '/../api/config/mongodb-helpers.php';

try {
    $users = collection('users');
    $email = 'admin@hrms.com';
    $password = 'password123';
    
    // Check if exists
    $existing = findOne($users, ['email' => $email]);
    if ($existing) {
        updateOne($users, ['_id' => $existing['_id']], [
            'password' => password_hash($password, PASSWORD_BCRYPT),
            'updated_at' => new MongoDB\BSON\UTCDateTime(),
        ]);
        echo "Admin user updated successfully with password 'password123'.\n";
    } else {
        insertOne($users, [
            'name' => 'Worexa Admin',
            'email' => $email,
            'password' => password_hash($password, PASSWORD_BCRYPT),
            'role' => 'hr',
            'created_at' => new MongoDB\BSON\UTCDateTime(),
            'updated_at' => new MongoDB\BSON\UTCDateTime(),
        ]);
        echo "Admin user created successfully with password 'password123'.\n";
    }
} catch (Throwable $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
