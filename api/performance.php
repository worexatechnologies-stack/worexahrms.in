<?php
/**
 * Performance Management API (OKRs & Reviews)
 *
 * GOALS:
 *   GET                          — List goals (employee: own; HR: all)
 *   POST                         — Create a goal
 *   PUT    ?id=X                 — Update goal progress/status
 *   DELETE ?id=X                 — Delete a goal
 *
 * REVIEWS:
 *   GET    ?action=reviews       — List reviews
 *   POST   ?action=create_review — Create a review cycle
 *   POST   ?action=submit_review — Submit a review
 *   GET    ?action=stats         — Performance dashboard stats
 */

declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
date_default_timezone_set('Asia/Kolkata');

$user = current_user();

$isHr = ($user['role'] ?? '') === 'hr';
$action = $_GET['action'] ?? '';
$id = id_param();

// ═══════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════
if (method() === 'GET' && $action === 'stats') {
    $goalCol = collection('goals');
    $reviewCol = collection('reviews');
    
    $filter = $isHr ? [] : ['assigned_to' => $user['id']];
    
    $goals = findMany($goalCol, $filter);
    $total = count($goals);
    $completed = 0;
    $onTrack = 0;
    $atRisk = 0;
    $avgProgress = 0;
    
    foreach ($goals as $g) {
        $status = $g['status'] ?? 'on_track';
        if ($status === 'completed') $completed++;
        elseif ($status === 'at_risk') $atRisk++;
        else $onTrack++;
        $avgProgress += (int)($g['progress'] ?? 0);
    }
    
    $avgProgress = $total > 0 ? round($avgProgress / $total) : 0;
    
    $reviewFilter = $isHr ? [] : ['employee_id' => $user['id']];
    $pendingReviews = countDocs($reviewCol, array_merge($reviewFilter, ['status' => 'pending']));
    
    ok([
        'total_goals' => $total,
        'completed_goals' => $completed,
        'on_track' => $onTrack,
        'at_risk' => $atRisk,
        'avg_progress' => $avgProgress,
        'pending_reviews' => $pendingReviews,
    ]);
}

// ═══════════════════════════════════════════════════════════
// GOALS CRUD
// ═══════════════════════════════════════════════════════════

// LIST GOALS
if (method() === 'GET' && !$action && !$id) {
    $filter = [];
    
    if (!$isHr) {
        $filter['assigned_to'] = $user['id'];
    } else if (!empty($_GET['employee_id'])) {
        $filter['assigned_to'] = $_GET['employee_id'];
    }
    
    if (!empty($_GET['quarter'])) $filter['quarter'] = $_GET['quarter'];
    if (!empty($_GET['year'])) $filter['year'] = (int)$_GET['year'];
    if (!empty($_GET['status'])) $filter['status'] = $_GET['status'];
    
    $goals = findMany(collection('goals'), $filter, ['sort' => ['created_at' => -1]]);
    
    foreach ($goals as &$g) {
        $g['id'] = (string)$g['_id'];
        unset($g['_id']);
        
        // Enrich with employee name
        if (!empty($g['assigned_to'])) {
            $emp = findOne(collection('employees'), ['_id' => mongoId($g['assigned_to'])]);
            $g['employee_name'] = $emp['name'] ?? 'Unknown';
        }
    }
    unset($g);
    
    ok($goals);
}

// CREATE GOAL
if (method() === 'POST' && !$action) {
    $data = input();
    require_fields($data, ['title']);
    
    $currentQuarter = 'Q' . ceil((int)date('n') / 3);
    
    $goal = [
        'title' => trim($data['title']),
        'description' => trim($data['description'] ?? ''),
        'key_results' => $data['key_results'] ?? [],
        'assigned_to' => $data['assigned_to'] ?? $user['id'],
        'department' => $data['department'] ?? $user['department'] ?? '',
        'quarter' => $data['quarter'] ?? $currentQuarter,
        'year' => (int)($data['year'] ?? date('Y')),
        'target_date' => $data['target_date'] ?? '',
        'progress' => 0,
        'status' => 'on_track', // on_track, at_risk, completed, cancelled
        'created_by' => $user['id'],
        'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s'),
    ];
    
    $result = insertOne(collection('goals'), $goal);
    $goal['id'] = (string)$result->getInsertedId();
    
    ok($goal, 'Goal created.', 201);
}

// UPDATE GOAL
if (method() === 'PUT' && $id && !$action) {
    $data = input();
    $update = ['updated_at' => date('Y-m-d H:i:s')];
    
    foreach (['title', 'description', 'target_date', 'quarter', 'department'] as $f) {
        if (isset($data[$f])) $update[$f] = trim((string)$data[$f]);
    }
    
    if (isset($data['progress'])) {
        $update['progress'] = max(0, min(100, (int)$data['progress']));
        if ($update['progress'] >= 100) $update['status'] = 'completed';
    }
    
    if (isset($data['status'])) {
        $validStatuses = ['on_track', 'at_risk', 'completed', 'cancelled'];
        if (in_array($data['status'], $validStatuses)) $update['status'] = $data['status'];
    }
    
    if (isset($data['key_results'])) {
        $update['key_results'] = $data['key_results'];
    }
    if (isset($data['year'])) {
        $update['year'] = (int)$data['year'];
    }
    
    // Allow employees to update their own goals, HR can update any
    $goalFilter = ['_id' => mongoId($id)];
    if (!$isHr) $goalFilter['assigned_to'] = $user['id'];
    
    updateOne(collection('goals'), $goalFilter, $update);
    ok(null, 'Goal updated.');
}

// DELETE GOAL
if (method() === 'DELETE' && $id) {
    $goalFilter = ['_id' => mongoId($id)];
    if (!$isHr) $goalFilter['assigned_to'] = $user['id'];
    
    collection('goals')->deleteOne($goalFilter);
    ok(null, 'Goal deleted.');
}

// ═══════════════════════════════════════════════════════════
// REVIEWS
// ═══════════════════════════════════════════════════════════

// LIST REVIEWS
if (method() === 'GET' && $action === 'reviews') {
    $filter = [];
    if (!$isHr) {
        $filter['$or'] = [
            ['employee_id' => $user['id']],
            ['reviewer_id' => $user['id']],
        ];
    }
    if (!empty($_GET['cycle_id'])) $filter['cycle_id'] = $_GET['cycle_id'];
    
    $reviews = findMany(collection('reviews'), $filter, ['sort' => ['created_at' => -1]]);
    
    foreach ($reviews as &$r) {
        $r['id'] = (string)$r['_id'];
        unset($r['_id']);
        
        // Enrich with names
        if (!empty($r['employee_id'])) {
            $emp = findOne(collection('employees'), ['_id' => mongoId($r['employee_id'])]);
            $r['employee_name'] = $emp['name'] ?? 'Unknown';
        }
        if (!empty($r['reviewer_id'])) {
            $reviewer = findOne(collection('employees'), ['_id' => mongoId($r['reviewer_id'])]);
            if (!$reviewer) $reviewer = findOne(collection('users'), ['_id' => mongoId($r['reviewer_id'])]);
            $r['reviewer_name'] = $reviewer['name'] ?? 'HR';
        }
    }
    unset($r);
    
    ok($reviews);
}

// CREATE REVIEW CYCLE
if (method() === 'POST' && $action === 'create_review') {
    if (!$isHr) fail('HR access required.', 403);
    
    $data = input();
    require_fields($data, ['title', 'employee_id']);
    
    $review = [
        'title' => trim($data['title']),
        'employee_id' => $data['employee_id'],
        'reviewer_id' => $data['reviewer_id'] ?? $user['id'],
        'type' => $data['type'] ?? 'quarterly', // quarterly, annual, peer, self
        'period' => $data['period'] ?? date('Y') . ' ' . ('Q' . ceil((int)date('n') / 3)),
        'status' => 'pending', // pending, in_progress, completed
        'ratings' => [],
        'comments' => '',
        'strengths' => '',
        'improvements' => '',
        'overall_rating' => 0,
        'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s'),
    ];
    
    $result = insertOne(collection('reviews'), $review);
    $review['id'] = (string)$result->getInsertedId();
    
    ok($review, 'Review created.', 201);
}

// SUBMIT REVIEW
if (method() === 'POST' && $action === 'submit_review') {
    $data = input();
    $reviewId = $data['review_id'] ?? '';
    if (!$reviewId) fail('Review ID required.', 400);
    
    $update = [
        'status' => 'completed',
        'updated_at' => date('Y-m-d H:i:s'),
    ];
    
    if (isset($data['ratings'])) $update['ratings'] = $data['ratings'];
    if (isset($data['comments'])) $update['comments'] = trim($data['comments']);
    if (isset($data['strengths'])) $update['strengths'] = trim($data['strengths']);
    if (isset($data['improvements'])) $update['improvements'] = trim($data['improvements']);
    if (isset($data['overall_rating'])) $update['overall_rating'] = max(0, min(5, (float)$data['overall_rating']));
    
    updateOne(collection('reviews'), ['_id' => mongoId($reviewId)], $update);
    ok(null, 'Review submitted.');
}

fail('Invalid request.', 400);
