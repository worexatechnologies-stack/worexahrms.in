<?php
/**
 * Helpdesk & Ticketing API
 *
 * TICKETS:
 *   GET                     — List tickets (HR sees all, employee sees own)
 *   POST                    — Create a ticket
 *   PUT    ?id=X            — Update ticket status, assign, add comment
 *   POST   ?action=comment&id=X — Add a comment to a ticket
 *   GET    ?action=stats    — Dashboard stats (open count, avg resolution time)
 */

declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
date_default_timezone_set('Asia/Kolkata');

$user = authUser();
if (!$user) fail('Authentication required.', 401);

$isHr = ($user['role'] ?? '') === 'hr';
$action = $_GET['action'] ?? '';
$id = id_param();

// ═══════════════════════════════════════════════════════════
// LIST TICKETS
// ═══════════════════════════════════════════════════════════
if (method() === 'GET' && !$action) {
    $filter = [];
    if (!$isHr) {
        // Employee sees only their tickets
        $filter['created_by'] = $user['id'];
    } else {
        // HR can filter via query params
        if (!empty($_GET['status'])) $filter['status'] = $_GET['status'];
        if (!empty($_GET['priority'])) $filter['priority'] = $_GET['priority'];
        if (!empty($_GET['category'])) $filter['category'] = $_GET['category'];
    }
    
    $tickets = findMany(collection('tickets'), $filter, ['sort' => ['created_at' => -1]]);
    foreach ($tickets as &$t) {
        $t['id'] = (string)$t['_id'];
        unset($t['_id']);
    }
    unset($t);
    ok($tickets);
}

// ═══════════════════════════════════════════════════════════
// CREATE TICKET
// ═══════════════════════════════════════════════════════════
if (method() === 'POST' && !$action) {
    $data = input();
    require_fields($data, ['subject', 'description', 'category']);
    
    $ticket = [
        'subject' => trim($data['subject']),
        'description' => trim($data['description']),
        'category' => trim($data['category']), // e.g., 'IT', 'HR', 'Facilities'
        'priority' => $data['priority'] ?? 'medium', // low, medium, high, urgent
        'status' => 'open', // open, in_progress, resolved, closed
        'created_by' => $user['id'],
        'assigned_to' => null,
        'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s'),
        'comments' => [],
    ];
    
    $result = insertOne(collection('tickets'), $ticket);
    $ticket['id'] = (string)$result->getInsertedId();
    ok($ticket, 'Ticket created.', 201);
}

// ═══════════════════════════════════════════════════════════
// UPDATE TICKET (status, priority, assign)
// ═══════════════════════════════════════════════════════════
if (method() === 'PUT' && $id && !$action) {
    $data = input();
    $update = ['updated_at' => date('Y-m-d H:i:s')];
    
    if (isset($data['status'])) $update['status'] = $data['status'];
    if (isset($data['priority'])) $update['priority'] = $data['priority'];
    if (isset($data['assigned_to'])) $update['assigned_to'] = $data['assigned_to'];
    if (isset($data['subject'])) $update['subject'] = trim($data['subject']);
    if (isset($data['description'])) $update['description'] = trim($data['description']);
    
    // Employees can only modify their own ticket's subject/description.
    $filter = ['_id' => mongoId($id)];
    if (!$isHr) $filter['created_by'] = $user['id'];
    
    updateOne(collection('tickets'), $filter, ['$set' => $update]);
    ok(null, 'Ticket updated.');
}

// ═══════════════════════════════════════════════════════════
// ADD COMMENT
// ═══════════════════════════════════════════════════════════
if (method() === 'POST' && $action === 'comment' && $id) {
    $data = input();
    $commentText = trim($data['comment'] ?? '');
    if ($commentText === '') fail('Comment text required.', 400);
    
    $comment = [
        'author_id' => $user['id'],
        'author_name' => $user['name'] ?? 'User',
        'text' => $commentText,
        'created_at' => date('Y-m-d H:i:s'),
    ];
    
    $filter = ['_id' => mongoId($id)];
    if (!$isHr) $filter['created_by'] = $user['id'];
    
    updateOne(collection('tickets'), $filter, [
        '$push' => ['comments' => $comment],
        '$set' => ['updated_at' => date('Y-m-d H:i:s')],
    ]);
    ok($comment, 'Comment added.');
}

// ═══════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════
if (method() === 'GET' && $action === 'stats') {
    if (!$isHr) fail('HR access required.', 403);
    
    $col = collection('tickets');
    $total = countDocs($col, []);
    $open = countDocs($col, ['status' => 'open']);
    $inProgress = countDocs($col, ['status' => 'in_progress']);
    $resolved = countDocs($col, ['status' => 'resolved']);
    $closed = countDocs($col, ['status' => 'closed']);
    
    // Average resolution time (resolved tickets only)
    $resolvedTickets = findMany($col, ['status' => 'resolved'], ['projection' => ['created_at' => 1, 'updated_at' => 1]]);
    $totalResolutionSec = 0;
    $countResolved = 0;
    foreach ($resolvedTickets as $t) {
        $created = strtotime($t['created_at']);
        $updated = strtotime($t['updated_at']);
        if ($created && $updated) {
            $totalResolutionSec += ($updated - $created);
            $countResolved++;
        }
    }
    $avgResolutionHours = $countResolved > 0 ? round($totalResolutionSec / $countResolved / 3600, 1) : 0;
    
    ok([
        'total' => $total,
        'open' => $open,
        'in_progress' => $inProgress,
        'resolved' => $resolved,
        'closed' => $closed,
        'avg_resolution_hours' => $avgResolutionHours,
    ]);
}

fail('Invalid request.', 400);
