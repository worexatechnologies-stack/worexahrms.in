<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$currentUser = current_user();
$method = method();
$id = $_GET['id'] ?? '';

// Only HR can write; all authenticated users can read
if (in_array($method, ['POST', 'PUT', 'DELETE'], true) && $currentUser['role'] !== 'hr') {
    fail('Only HR can manage departments.', 403);
}

function normaliseDept(array $doc): array
{
    $doc['id']  = (string)($doc['_id'] ?? '');
    $doc['_id'] = $doc['id'];
    foreach (['created_at', 'updated_at'] as $f) {
        if (isset($doc[$f])) {
            // Handle UTCDateTime objects
            if ($doc[$f] instanceof MongoDB\BSON\UTCDateTime) {
                $doc[$f] = $doc[$f]->toDateTime()
                    ->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
            }
            // Handle BSONDocument with $date property (from JSON imports)
            elseif ($doc[$f] instanceof MongoDB\Model\BSONDocument && isset($doc[$f]['$date'])) {
                try {
                    $dt = new DateTime($doc[$f]['$date']);
                    $doc[$f] = $dt->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d H:i:s');
                } catch (Exception) {
                    $doc[$f] = '';
                }
            }
        }
    }
    return $doc;
}

try {
    $depts = collection('departments');
    $emps  = collection('employees');

    /* ── GET ── */
    if ($method === 'GET') {
        // Special action: seed sample data (only if empty)
        if (isset($_GET['seed']) && $_GET['seed'] === '1') {
            $count = countDocs($depts, []);
            if ($count > 0) fail('Departments already exist. Clear them first to re-seed.', 409);

            $sampleDepts = [
                ['name' => 'IT', 'description' => 'Information Technology', 'color' => '#3b82f6'],
                ['name' => 'HR', 'description' => 'Human Resources', 'color' => '#10b981'],
                ['name' => 'Social Media', 'description' => 'Social Media Marketing', 'color' => '#ec4899'],
                ['name' => 'BDE', 'description' => 'Business & Brand Excellence', 'color' => '#f59e0b'],
                ['name' => 'Accounting', 'description' => 'Finance & Accounting', 'color' => '#6366f1'],
                ['name' => 'Sales', 'description' => 'Sales & Business Development', 'color' => '#ef4444'],
                ['name' => 'SEO', 'description' => 'Search Engine Optimization', 'color' => '#14b8a6'],
                ['name' => 'Performance Marketing', 'description' => 'Performance Marketing & Analytics', 'color' => '#8b5cf6'],
            ];

            foreach ($sampleDepts as $d) {
                insertOne($depts, [
                    'name' => $d['name'],
                    'description' => $d['description'],
                    'color' => $d['color'],
                    'created_at' => new MongoDB\BSON\UTCDateTime(),
                    'updated_at' => new MongoDB\BSON\UTCDateTime(),
                ]);
            }

            ok(['count' => count($sampleDepts)], 'Sample departments created successfully.');
        }

        if ($id) {
            $doc = findOne($depts, ['_id' => mongoId($id)]);
            if (!$doc) fail('Department not found.', 404);
            $norm = normaliseDept($doc);
            // Attach employee count
            $norm['employee_count'] = countDocs($emps, ['department' => $norm['name'], 'status' => 'active']);
            ok($norm);
        }

        $all  = findMany($depts, [], ['sort' => ['name' => 1]]);
        $data = array_map(function(array $d) use ($emps) {
            $norm = normaliseDept($d);
            $norm['employee_count'] = countDocs($emps, ['department' => $norm['name'], 'status' => 'active']);
            return $norm;
        }, $all);
        ok($data);
    }

    /* ── POST — create ── */
    if ($method === 'POST' && !$id) {
        // Special action: seed sample departments
        if (isset($_GET['seed']) && $_GET['seed'] === '1') {
            $count = countDocs($depts, []);
            if ($count > 0) fail('Departments already exist. Clear them first to re-seed.', 409);

            $sampleDepts = [
                ['name' => 'IT', 'description' => 'Information Technology', 'color' => '#3b82f6'],
                ['name' => 'HR', 'description' => 'Human Resources', 'color' => '#10b981'],
                ['name' => 'Social Media', 'description' => 'Social Media Marketing', 'color' => '#ec4899'],
                ['name' => 'BDE', 'description' => 'Business & Brand Excellence', 'color' => '#f59e0b'],
                ['name' => 'Accounting', 'description' => 'Finance & Accounting', 'color' => '#6366f1'],
                ['name' => 'Sales', 'description' => 'Sales & Business Development', 'color' => '#ef4444'],
                ['name' => 'SEO', 'description' => 'Search Engine Optimization', 'color' => '#14b8a6'],
                ['name' => 'Performance Marketing', 'description' => 'Performance Marketing & Analytics', 'color' => '#8b5cf6'],
            ];

            foreach ($sampleDepts as $d) {
                insertOne($depts, [
                    'name' => $d['name'],
                    'description' => $d['description'],
                    'color' => $d['color'],
                    'created_at' => new MongoDB\BSON\UTCDateTime(),
                    'updated_at' => new MongoDB\BSON\UTCDateTime(),
                ]);
            }

            ok(['count' => count($sampleDepts)], 'Sample departments created successfully.');
        }

        $body = json_decode(file_get_contents('php://input') ?: '', true) ?? $_POST;
        $name = trim($body['name'] ?? '');
        if (!$name) fail('Department name is required.', 422);

        // Prevent duplicates (case-insensitive)
        $existing = findOne($depts, ['name' => ['$regex' => '^' . preg_quote($name, '/') . '$', '$options' => 'i']]);
        if ($existing) fail('Department already exists.', 409);

        $doc = [
            'name'        => $name,
            'description' => trim($body['description'] ?? ''),
            'color'       => trim($body['color'] ?? '#6366f1'),
            'created_at'  => new MongoDB\BSON\UTCDateTime(),
            'updated_at'  => new MongoDB\BSON\UTCDateTime(),
        ];
        $result = insertOne($depts, $doc);
        ok(normaliseDept($result), 'Department created.', 201);
    }

    /* ── PUT — update ── */
    if ($method === 'PUT' && $id) {
        $body     = json_decode(file_get_contents('php://input') ?: '', true) ?? $_POST;
        $existing = findOne($depts, ['_id' => mongoId($id)]);
        if (!$existing) fail('Department not found.', 404);

        $update = ['updated_at' => new MongoDB\BSON\UTCDateTime()];
        if (!empty($body['name'])) {
            $newName = trim($body['name']);
            $oldName = $existing['name'] ?? '';
            // Check uniqueness (excluding self)
            $dup = findOne($depts, ['name' => ['$regex' => '^' . preg_quote($newName, '/') . '$', '$options' => 'i']]);
            if ($dup && (string)$dup['_id'] !== $id) fail('Department name already taken.', 409);
            $update['name'] = $newName;
            // Cascade rename on employees
            if ($oldName && $oldName !== $newName) {
                collection('employees')->updateMany(
                    ['department' => $oldName],
                    ['$set' => ['department' => $newName]]
                );
            }
        }
        if (array_key_exists('description', $body)) $update['description'] = trim($body['description'] ?? '');
        if (!empty($body['color']))                  $update['color']       = trim($body['color']);

        updateOne($depts, ['_id' => mongoId($id)], $update);
        $updated = findOne($depts, ['_id' => mongoId($id)]);
        ok(normaliseDept($updated), 'Department updated.');
    }

    /* ── DELETE ── */
    if ($method === 'DELETE' && $id) {
        $existing = findOne($depts, ['_id' => mongoId($id)]);
        if (!$existing) fail('Department not found.', 404);

        $empCount = countDocs($emps, ['department' => $existing['name'], 'status' => 'active']);
        if ($empCount > 0) fail("Cannot delete: {$empCount} active employee(s) still in this department. Reassign them first.", 409);

        deleteOne($depts, ['_id' => mongoId($id)]);
        ok(null, 'Department deleted.');
    }

    fail('Method not allowed.', 405);
} catch (Throwable $e) {
    if (in_array(http_response_code(), [400, 401, 403, 404, 409, 422], true)) throw $e;
    fail($e->getMessage(), 500);
}
