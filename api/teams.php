<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$currentUser = current_user();
$method = method();
$id = $_GET['id'] ?? '';

// Only HR can write; all can read
if (in_array($method, ['POST', 'PUT', 'DELETE'], true) && $currentUser['role'] !== 'hr') {
    fail('Only HR can manage teams.', 403);
}

function normaliseTeam(array $doc): array
{
    $doc['id']  = (string)($doc['_id'] ?? '');
    $doc['_id'] = $doc['id'];
    if (isset($doc['created_at']) && $doc['created_at'] instanceof MongoDB\BSON\UTCDateTime) {
        $doc['created_at'] = $doc['created_at']->toDateTime()
            ->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
    }
    if (isset($doc['updated_at']) && $doc['updated_at'] instanceof MongoDB\BSON\UTCDateTime) {
        $doc['updated_at'] = $doc['updated_at']->toDateTime()
            ->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
    }
    return $doc;
}

try {
    $teams = collection('teams');
    $emps  = collection('employees');

    /* ── GET ── */
    if ($method === 'GET') {
        // Special action: seed sample data (only if empty)
        if (isset($_GET['seed']) && $_GET['seed'] === '1') {
            $count = countDocs($teams, []);
            if ($count > 0) fail('Teams already exist. Clear them first to re-seed.', 409);

            $sampleTeams = [
                ['name' => 'Backend Team', 'description' => 'Server-side development', 'department' => 'IT'],
                ['name' => 'Frontend Team', 'description' => 'UI/UX development', 'department' => 'IT'],
                ['name' => 'DevOps Team', 'description' => 'Infrastructure & deployment', 'department' => 'IT'],
                ['name' => 'Recruitment', 'description' => 'Talent acquisition', 'department' => 'HR'],
                ['name' => 'Content Creators', 'description' => 'Social media content', 'department' => 'Social Media'],
                ['name' => 'SEO Specialists', 'description' => 'Organic search optimization', 'department' => 'SEO'],
            ];

            foreach ($sampleTeams as $t) {
                insertOne($teams, [
                    'name' => $t['name'],
                    'description' => $t['description'],
                    'department' => $t['department'],
                    'team_lead_id' => null,
                    'member_ids' => [],
                    'created_at' => new MongoDB\BSON\UTCDateTime(),
                    'updated_at' => new MongoDB\BSON\UTCDateTime(),
                ]);
            }

            ok(['count' => count($sampleTeams)], 'Sample teams created successfully.');
        }

        if ($id) {
            $doc = findOne($teams, ['_id' => mongoId($id)]);
            if (!$doc) fail('Team not found.', 404);
            $norm = normaliseTeam($doc);
            // Hydrate team lead + members
            if (!empty($norm['team_lead_id'])) {
                $lead = findOne($emps, ['_id' => mongoId($norm['team_lead_id'])]);
                $norm['team_lead'] = $lead ? ['id' => (string)$lead['_id'], 'name' => $lead['name']] : null;
            }
            $norm['members'] = [];
            if (!empty($norm['member_ids']) && is_array($norm['member_ids'])) {
                foreach ($norm['member_ids'] as $mid) {
                    $m = findOne($emps, ['_id' => mongoId($mid)]);
                    if ($m) $norm['members'][] = ['id' => (string)$m['_id'], 'name' => $m['name']];
                }
            }
            ok($norm);
        }

        $all  = findMany($teams, [], ['sort' => ['name' => 1]]);
        $data = array_map(function($t) use ($emps) {
            $norm = normaliseTeam($t);
            $norm['member_count'] = count($norm['member_ids'] ?? []);
            if (!empty($norm['team_lead_id'])) {
                $lead = findOne($emps, ['_id' => mongoId($norm['team_lead_id'])]);
                $norm['team_lead_name'] = $lead ? $lead['name'] : null;
            }
            return $norm;
        }, $all);
        ok($data);
    }

    /* ── POST — create ── */
    if ($method === 'POST' && !$id) {
        // Special action: seed sample teams
        if (isset($_GET['seed']) && $_GET['seed'] === '1') {
            $count = countDocs($teams, []);
            if ($count > 0) fail('Teams already exist. Clear them first to re-seed.', 409);

            $sampleTeams = [
                ['name' => 'Backend Team', 'description' => 'Server-side development', 'department' => 'IT'],
                ['name' => 'Frontend Team', 'description' => 'UI/UX development', 'department' => 'IT'],
                ['name' => 'DevOps Team', 'description' => 'Infrastructure & deployment', 'department' => 'IT'],
                ['name' => 'Recruitment', 'description' => 'Talent acquisition', 'department' => 'HR'],
                ['name' => 'Content Creators', 'description' => 'Social media content', 'department' => 'Social Media'],
                ['name' => 'SEO Specialists', 'description' => 'Organic search optimization', 'department' => 'SEO'],
            ];

            foreach ($sampleTeams as $t) {
                insertOne($teams, [
                    'name' => $t['name'],
                    'description' => $t['description'],
                    'department' => $t['department'],
                    'team_lead_id' => null,
                    'member_ids' => [],
                    'created_at' => new MongoDB\BSON\UTCDateTime(),
                    'updated_at' => new MongoDB\BSON\UTCDateTime(),
                ]);
            }

            ok(['count' => count($sampleTeams)], 'Sample teams created successfully.');
        }

        $body = json_decode(file_get_contents('php://input') ?: '', true) ?? $_POST;
        $name = trim($body['name'] ?? '');
        if (!$name) fail('Team name is required.', 422);

        $existing = findOne($teams, ['name' => ['$regex' => '^' . preg_quote($name, '/') . '$', '$options' => 'i']]);
        if ($existing) fail('Team name already exists.', 409);

        $doc = [
            'name'          => $name,
            'description'   => trim($body['description'] ?? ''),
            'department'    => trim($body['department'] ?? ''),
            'team_lead_id'  => !empty($body['team_lead_id']) ? trim($body['team_lead_id']) : null,
            'member_ids'    => !empty($body['member_ids']) && is_array($body['member_ids']) ? $body['member_ids'] : [],
            'created_at'    => new MongoDB\BSON\UTCDateTime(),
            'updated_at'    => new MongoDB\BSON\UTCDateTime(),
        ];
        $result = insertOne($teams, $doc);
        ok(normaliseTeam($result), 'Team created.', 201);
    }

    /* ── PUT — update ── */
    if ($method === 'PUT' && $id) {
        $body     = json_decode(file_get_contents('php://input') ?: '', true) ?? $_POST;
        $existing = findOne($teams, ['_id' => mongoId($id)]);
        if (!$existing) fail('Team not found.', 404);

        $update = ['updated_at' => new MongoDB\BSON\UTCDateTime()];
        if (!empty($body['name'])) {
            $newName = trim($body['name']);
            $dup = findOne($teams, ['name' => ['$regex' => '^' . preg_quote($newName, '/') . '$', '$options' => 'i']]);
            if ($dup && (string)$dup['_id'] !== $id) fail('Team name already taken.', 409);
            $update['name'] = $newName;
        }
        if (array_key_exists('description', $body)) $update['description'] = trim($body['description'] ?? '');
        if (array_key_exists('department', $body))  $update['department']  = trim($body['department'] ?? '');
        if (array_key_exists('team_lead_id', $body)) {
            $update['team_lead_id'] = !empty($body['team_lead_id']) ? trim($body['team_lead_id']) : null;
        }
        if (array_key_exists('member_ids', $body)) {
            $update['member_ids'] = is_array($body['member_ids']) ? $body['member_ids'] : [];
        }

        updateOne($teams, ['_id' => mongoId($id)], $update);
        $updated = findOne($teams, ['_id' => mongoId($id)]);
        ok(normaliseTeam($updated), 'Team updated.');
    }

    /* ── DELETE ── */
    if ($method === 'DELETE' && $id) {
        $existing = findOne($teams, ['_id' => mongoId($id)]);
        if (!$existing) fail('Team not found.', 404);
        deleteOne($teams, ['_id' => mongoId($id)]);
        ok(null, 'Team deleted.');
    }

    fail('Method not allowed.', 405);
} catch (Throwable $e) {
    if (in_array(http_response_code(), [400, 401, 403, 404, 409, 422], true)) throw $e;
    fail($e->getMessage(), 500);
}
