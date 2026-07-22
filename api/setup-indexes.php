<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

$results = [];

// Helper to create index with try-catch
function tryCreateIndex(string $collection, array $keys, array $options = []) {
    global $results;
    try {
        collection($collection)->createIndex($keys, $options);
        $results[] = "Successfully created index on $collection (" . json_encode($keys) . ")";
    } catch (Exception $e) {
        $results[] = "Skipped or already exists for $collection (" . json_encode($keys) . "): " . $e->getMessage();
    }
}

try {
    tryCreateIndex('employees', ['employee_code' => 1], ['sparse' => true]);
    tryCreateIndex('attendance', ['employee_id' => 1, 'date' => -1]);
    tryCreateIndex('attendance', ['date' => -1, 'status' => 1]);
    tryCreateIndex('break_requests', ['status' => 1, 'created_at' => -1]);
    tryCreateIndex('notifications', ['user_id' => 1, 'is_read' => 1, 'created_at' => -1]);
    tryCreateIndex('notifications', ['user_id' => 1, 'role' => 1, 'is_read' => 1, 'created_at' => -1]);
    tryCreateIndex('notifications', ['event_id' => 1], ['unique' => true, 'sparse' => true]);
    tryCreateIndex('notifications', ['user_id' => 1, 'role' => 1, 'event_id' => 1, '_id' => 1]);
    tryCreateIndex('team_chat_messages', ['conversation_id' => 1, 'created_at' => -1]);
    tryCreateIndex('chat_messages', ['room_id' => 1, 'created_at' => -1]);
    tryCreateIndex('leaves', ['employee_id' => 1, 'status' => 1, 'created_at' => -1]);
    tryCreateIndex('wfh', ['employee_id' => 1, 'status' => 1, 'created_at' => -1]);
    tryCreateIndex('wfh_status_updates', ['employee_id' => 1, 'created_at' => -1]);
    tryCreateIndex('wfh_status_updates', ['date' => 1]);

    echo json_encode(['success' => true, 'details' => $results]);
} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => 'Index script failed: ' . $e->getMessage()]);
}
