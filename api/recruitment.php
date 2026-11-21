<?php
/**
 * Recruitment & ATS API
 *
 * JOBS:
 *   GET                   — List all jobs (filters: status, department)
 *   POST                  — Create a job posting
 *   PUT    ?id=X          — Update a job posting
 *   DELETE ?id=X          — Delete a job posting
 *
 * APPLICANTS:
 *   GET    ?job_id=X      — List applicants for a job
 *   POST   ?action=apply  — Submit an application
 *   PUT    ?action=update_applicant&id=X — Update applicant stage
 *   POST   ?action=add_note&id=X        — Add interview note
 *   GET    ?action=stats                 — Recruitment dashboard stats
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
    if (!$isHr) fail('HR access required.', 403);
    
    $jobs = collection('jobs');
    $applicants = collection('applicants');
    
    $totalJobs = countDocs($jobs, []);
    $openJobs = countDocs($jobs, ['status' => 'open']);
    $totalApplicants = countDocs($applicants, []);
    
    $thisMonth = date('Y-m-01');
    $newApplicants = countDocs($applicants, [
        'applied_at' => ['$gte' => $thisMonth]
    ]);
    
    $hired = countDocs($applicants, ['stage' => 'hired']);
    $hireRate = $totalApplicants > 0 ? round(($hired / $totalApplicants) * 100, 1) : 0;
    
    // Stage breakdown
    $stages = ['applied' => 0, 'screening' => 0, 'interview' => 0, 'offered' => 0, 'hired' => 0, 'rejected' => 0];
    $allApplicants = findMany($applicants, [], ['limit' => 5000]);
    foreach ($allApplicants as $app) {
        $stage = $app['stage'] ?? 'applied';
        if (isset($stages[$stage])) $stages[$stage]++;
    }
    
    ok([
        'total_jobs' => $totalJobs,
        'open_jobs' => $openJobs,
        'total_applicants' => $totalApplicants,
        'new_applicants_this_month' => $newApplicants,
        'hired' => $hired,
        'hire_rate' => $hireRate,
        'stage_breakdown' => $stages,
    ]);
}

// HR pipeline view used by Talent & Hiring.
if (method() === 'GET' && $action === 'pipeline') {
    if (!$isHr) fail('HR access required.', 403);
    $applicants = findMany(collection('applicants'), [], ['sort' => ['applied_at' => -1], 'limit' => 5000]);
    foreach ($applicants as &$applicant) {
        $applicant['id'] = (string)$applicant['_id'];
        $applicant['candidate_name'] = $applicant['candidate_name'] ?? $applicant['name'] ?? '';
        $applicant['position'] = $applicant['position'] ?? $applicant['job_title'] ?? '';
        $applicant['source'] = $applicant['source'] ?? 'Direct';
        unset($applicant['_id']);
    }
    unset($applicant);
    ok(['applications' => $applicants]);
}

// Add a candidate directly to the HR pipeline before a job posting is linked.
if (method() === 'POST' && $action === 'add_candidate') {
    if (!$isHr) fail('HR access required.', 403);
    $data = input();
    require_fields($data, ['candidate_name', 'position']);
    $candidate = [
        'name' => trim((string)$data['candidate_name']),
        'candidate_name' => trim((string)$data['candidate_name']),
        'email' => strtolower(trim((string)($data['email'] ?? ''))),
        'phone' => trim((string)($data['phone'] ?? '')),
        'position' => trim((string)$data['position']),
        'department' => trim((string)($data['department'] ?? 'Engineering')),
        'source' => trim((string)($data['source'] ?? 'Direct')),
        'interview_date' => trim((string)($data['interview_date'] ?? '')),
        'experience_years' => isset($data['experience_years']) && $data['experience_years'] !== '' ? (float)$data['experience_years'] : null,
        'location' => trim((string)($data['location'] ?? '')),
        'employment_type' => trim((string)($data['employment_type'] ?? 'Full time')),
        'recruiter_notes' => trim((string)($data['notes'] ?? '')),
        'stage' => 'applied',
        'notes' => [],
        'rating' => 0,
        'applied_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s'),
        'created_by' => $user['id'],
    ];
    $result = insertOne(collection('applicants'), $candidate);
    $candidate['id'] = (string)($result['_id'] ?? '');
    ok($candidate, 'Candidate added to the hiring pipeline.', 201);
}

if (method() === 'PUT' && $action === 'update_candidate' && $id) {
    if (!$isHr) fail('HR access required.', 403);
    $data = input();
    $stage = (string)($data['stage'] ?? '');
    if (!in_array($stage, ['applied', 'screening', 'interview', 'offer', 'offered', 'hired', 'rejected'], true)) fail('Invalid candidate stage.', 400);
    updateOne(collection('applicants'), ['_id' => mongoId($id)], [
        'stage' => $stage === 'offer' ? 'offered' : $stage,
        'updated_at' => date('Y-m-d H:i:s'),
    ]);
    ok(null, 'Candidate stage updated.');
}

if (method() === 'DELETE' && $action === 'delete_candidate' && $id) {
    if (!$isHr) fail('HR access required.', 403);
    collection('applicants')->deleteOne(['_id' => mongoId($id)]);
    ok(null, 'Candidate removed from the pipeline.');
}

// ═══════════════════════════════════════════════════════════
// JOBS CRUD
// ═══════════════════════════════════════════════════════════

// LIST JOBS
if (method() === 'GET' && !$id && !$action) {
    $filter = [];
    if (!empty($_GET['status'])) $filter['status'] = $_GET['status'];
    if (!empty($_GET['department'])) $filter['department'] = $_GET['department'];
    
    $jobs = findMany(collection('jobs'), $filter, ['sort' => ['created_at' => -1]]);
    
    // Enrich with applicant count
    foreach ($jobs as &$job) {
        $job['id'] = (string)$job['_id'];
        $job['applicant_count'] = countDocs(collection('applicants'), ['job_id' => $job['id']]);
        unset($job['_id']);
    }
    unset($job);
    
    ok($jobs);
}

// GET APPLICANTS FOR A JOB
if (method() === 'GET' && !empty($_GET['job_id'])) {
    if (!$isHr) fail('HR access required.', 403);
    
    $jobId = $_GET['job_id'];
    $applicants = findMany(collection('applicants'), ['job_id' => $jobId], ['sort' => ['applied_at' => -1]]);
    
    foreach ($applicants as &$app) {
        $app['id'] = (string)$app['_id'];
        unset($app['_id']);
    }
    unset($app);
    
    ok($applicants);
}

// CREATE JOB
if (method() === 'POST' && !$action) {
    if (!$isHr) fail('HR access required.', 403);
    
    $data = input();
    require_fields($data, ['title', 'department']);
    
    $job = [
        'title' => trim($data['title']),
        'department' => trim($data['department']),
        'description' => trim($data['description'] ?? ''),
        'requirements' => trim($data['requirements'] ?? ''),
        'location' => trim($data['location'] ?? 'Office'),
        'employment_type' => $data['employment_type'] ?? 'full_time',
        'salary_range' => trim($data['salary_range'] ?? ''),
        'status' => 'open',
        'created_by' => $user['id'],
        'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s'),
    ];
    
    $result = insertOne(collection('jobs'), $job);
    $job['id'] = (string)$result->getInsertedId();
    
    ok($job, 'Job posting created.', 201);
}

// UPDATE JOB
if (method() === 'PUT' && $id && !$action) {
    if (!$isHr) fail('HR access required.', 403);
    
    $data = input();
    $update = ['updated_at' => date('Y-m-d H:i:s')];
    
    foreach (['title', 'department', 'description', 'requirements', 'location', 'employment_type', 'salary_range', 'status'] as $f) {
        if (isset($data[$f])) $update[$f] = trim((string)$data[$f]);
    }
    
    updateOne(collection('jobs'), ['_id' => mongoId($id)], $update);
    ok(null, 'Job posting updated.');
}

// DELETE JOB
if (method() === 'DELETE' && $id) {
    if (!$isHr) fail('HR access required.', 403);
    
    collection('jobs')->deleteOne(['_id' => mongoId($id)]);
    collection('applicants')->deleteMany(['job_id' => $id]);
    ok(null, 'Job posting deleted.');
}

// ═══════════════════════════════════════════════════════════
// APPLICANTS
// ═══════════════════════════════════════════════════════════

// APPLY
if (method() === 'POST' && $action === 'apply') {
    $data = input();
    require_fields($data, ['job_id', 'name', 'email']);
    
    $applicant = [
        'job_id' => $data['job_id'],
        'name' => trim($data['name']),
        'email' => strtolower(trim($data['email'])),
        'candidate_name' => trim($data['candidate_name'] ?? $data['name']),
        'position' => trim($data['position'] ?? ''),
        'department' => trim($data['department'] ?? ''),
        'source' => trim($data['source'] ?? 'Direct'),
        'interview_date' => trim($data['interview_date'] ?? ''),
        'experience_years' => isset($data['experience_years']) && $data['experience_years'] !== '' ? (float)$data['experience_years'] : null,
        'location' => trim($data['location'] ?? ''),
        'employment_type' => trim($data['employment_type'] ?? 'full_time'),
        'recruiter_notes' => trim($data['notes'] ?? ''),
        'phone' => trim($data['phone'] ?? ''),
        'resume_text' => trim($data['resume_text'] ?? ''),
        'cover_letter' => trim($data['cover_letter'] ?? ''),
        'stage' => 'applied',
        'notes' => [],
        'rating' => 0,
        'applied_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s'),
    ];
    
    $result = insertOne(collection('applicants'), $applicant);
    $applicant['id'] = (string)($result['_id'] ?? '');
    $applicant['_id'] = $applicant['id'];
    
    ok($applicant, 'Application submitted.', 201);
}

// UPDATE APPLICANT STAGE
if (method() === 'PUT' && $action === 'update_applicant' && $id) {
    if (!$isHr) fail('HR access required.', 403);
    
    $data = input();
    $update = ['updated_at' => date('Y-m-d H:i:s')];
    
    if (isset($data['stage'])) {
        $validStages = ['applied', 'screening', 'interview', 'offered', 'hired', 'rejected'];
        if (!in_array($data['stage'], $validStages)) fail('Invalid stage.', 400);
        $update['stage'] = $data['stage'];
    }
    if (isset($data['rating'])) $update['rating'] = (int)$data['rating'];
    
    updateOne(collection('applicants'), ['_id' => mongoId($id)], $update);
    ok(null, 'Applicant updated.');
}

// ADD NOTE
if (method() === 'POST' && $action === 'add_note' && $id) {
    if (!$isHr) fail('HR access required.', 403);
    
    $data = input();
    $note = [
        'text' => trim($data['text'] ?? ''),
        'author' => $user['name'] ?? 'HR',
        'created_at' => date('Y-m-d H:i:s'),
    ];
    
    updateOne(collection('applicants'), ['_id' => mongoId($id)], [
        '$push' => ['notes' => $note],
        '$set' => ['updated_at' => date('Y-m-d H:i:s')],
    ]);
    
    ok($note, 'Note added.');
}

fail('Invalid request.', 400);
