<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

// Verify the request is authenticated (any role can read; HR only for writes)
$currentUser = current_user();

$method = method();
$id     = $_GET['id'] ?? '';

// Helper: normalise a MongoDB doc for JSON output
function normaliseEmployee(array $doc): array
{
    $doc['id']  = (string)($doc['_id'] ?? '');
    $doc['_id'] = $doc['id'];
    foreach (['joining_date', 'date_of_birth', 'created_at', 'updated_at'] as $f) {
        if (isset($doc[$f])) {
            // Handle UTCDateTime objects
            if ($doc[$f] instanceof MongoDB\BSON\UTCDateTime) {
                $doc[$f] = $doc[$f]->toDateTime()
                    ->setTimezone(new DateTimeZone('Asia/Kolkata'))
                    ->format('Y-m-d');
            }
            // Handle BSONDocument with $date property (from JSON imports)
            elseif ($doc[$f] instanceof MongoDB\Model\BSONDocument && isset($doc[$f]['$date'])) {
                try {
                    $dt = new DateTime($doc[$f]['$date']);
                    $doc[$f] = $dt->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d');
                } catch (Exception) {
                    $doc[$f] = '';
                }
            }
        }
    }
    // Expose plain password as current_password for HR management
    $doc['current_password'] = !empty($doc['plain_password']) ? (string)$doc['plain_password'] : null;
    unset($doc['password']); // never expose hashed password
    unset($doc['plain_password']);
    return $doc;
}

// Helper: read body from either FormData or JSON
function empBody(): array
{
    $ct = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
    if (str_contains($ct, 'multipart/form-data') || str_contains($ct, 'application/x-www-form-urlencoded') || !empty($_POST)) {
        return $_POST;
    }
    return json_decode(file_get_contents('php://input') ?: '', true) ?? [];
}

/**
 * Process uploaded image: resize & compress to ≤100 KB, return base64 data URI.
 * Falls back to raw base64 if GD is unavailable.
 */
function processProfileImage(array $file): ?string
{
    if (empty($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
        return null;
    }

    $tmpPath  = $file['tmp_name'];
    $origName = $file['name'] ?? 'image';
    $ext      = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    $mimeMap  = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'];

    if (!isset($mimeMap[$ext])) {
        return null; // unsupported type
    }

    // ── Path A: GD available — resize + compress ────────────────────
    if (extension_loaded('gd') && function_exists('imagecreatefromjpeg')) {

        $img = match ($ext) {
            'png'  => @imagecreatefrompng($tmpPath),
            'gif'  => @imagecreatefromgif($tmpPath),
            'webp' => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($tmpPath) : false,
            default => @imagecreatefromjpeg($tmpPath),
        };

        if ($img) {
            $origW = imagesx($img);
            $origH = imagesy($img);
            $maxDim = 300;

            // Resize to max 300×300 keeping aspect ratio
            if ($origW > $maxDim || $origH > $maxDim) {
                if ($origW >= $origH) {
                    $newW = $maxDim;
                    $newH = (int)round($origH * $maxDim / $origW);
                } else {
                    $newH = $maxDim;
                    $newW = (int)round($origW * $maxDim / $origH);
                }
                $resized = imagecreatetruecolor($newW, $newH);
                // White background for transparent images
                $white = imagecolorallocate($resized, 255, 255, 255);
                imagefilledrectangle($resized, 0, 0, $newW, $newH, $white);
                imagecopyresampled($resized, $img, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
                imagedestroy($img);
                $img = $resized;
            }

            // Compress JPEG iteratively until ≤ 95 KB
            $targetBytes = 95 * 1024;
            $quality     = 85;
            $raw         = '';

            do {
                ob_start();
                imagejpeg($img, null, $quality);
                $raw      = (string)ob_get_clean();
                $quality -= 10;
            } while (strlen($raw) > $targetBytes && $quality >= 20);

            imagedestroy($img);

            if ($raw !== '') {
                return 'data:image/jpeg;base64,' . base64_encode($raw);
            }
        }
    }

    // ── Path B: GD unavailable — use Imagick if available ──────────
    if (extension_loaded('imagick') && class_exists('Imagick')) {
        try {
            $imagick = new Imagick($tmpPath);
            $imagick->setImageFormat('jpeg');
            $imagick->thumbnailImage(300, 300, true);
            $imagick->setImageCompressionQuality(82);
            $blob = $imagick->getImageBlob();
            $imagick->clear();
            if ($blob) {
                return 'data:image/jpeg;base64,' . base64_encode($blob);
            }
        } catch (Exception $e) {
            // fall through to raw fallback
        }
    }

    // ── Path C: Neither GD nor Imagick — store raw bytes as base64 ─
    // Client-side already compressed the image, so this should be ≤200KB
    $raw = file_get_contents($tmpPath);
    if ($raw === false || strlen($raw) === 0) {
        return null;
    }

    // Reject if raw file is too large (> 500KB) to keep MongoDB docs reasonable
    if (strlen($raw) > 500 * 1024) {
        return null; // Too large without compression
    }

    $mime = $mimeMap[$ext] ?? 'image/jpeg';
    return "data:{$mime};base64," . base64_encode($raw);
}

try {
    $employees = collection('employees');

    /* ── GET ─────────────────────────────────────────────────────── */
    if ($method === 'GET') {
        // Special action: debug image upload capabilities
        if (isset($_GET['action']) && $_GET['action'] === 'debug_image') {
            $info = [
                'gd_loaded'           => extension_loaded('gd'),
                'gd_info'             => function_exists('gd_info') ? gd_info() : 'unavailable',
                'imagecreatefromjpeg' => function_exists('imagecreatefromjpeg'),
                'imagecreatefrompng'  => function_exists('imagecreatefrompng'),
                'imagecreatefromwebp' => function_exists('imagecreatefromwebp'),
                'upload_max_filesize' => ini_get('upload_max_filesize'),
                'post_max_size'       => ini_get('post_max_size'),
                'file_uploads'        => ini_get('file_uploads'),
                'max_execution_time'  => ini_get('max_execution_time'),
                'memory_limit'        => ini_get('memory_limit'),
                'php_version'         => PHP_VERSION,
            ];
            ok($info);
        }

        // Special action: return just the list of department names (for dropdowns)
        if (isset($_GET['action']) && $_GET['action'] === 'departments') {
            $deptDocs = findMany(collection('departments'), [], ['sort' => ['name' => 1]]);
            $names = array_map(fn($d) => $d['name'], $deptDocs);
            ok($names);
        }

        $page       = isset($_GET['page'])     ? (int)$_GET['page']     : null;
        $per_page   = isset($_GET['per_page']) ? (int)$_GET['per_page'] : null;
        $status     = $_GET['status']     ?? 'active';
        $department = $_GET['department'] ?? '';
        $search     = trim($_GET['search'] ?? '');

        // Employees can only list active employees (read-only directory mode)
        $isEmployee = ($currentUser['role'] !== 'hr');
        if ($isEmployee && $status === '') $status = 'active';

        $filter = [];
        if ($id !== '') {
            $isMongoId = preg_match('/^[a-f\d]{24}$/i', $id);
            $filter['_id'] = $isMongoId ? mongoId($id) : (int)$id;
        } else {
            if ($status !== '')     $filter['status']     = $status;
            if ($department !== '') $filter['department'] = $department;
            if ($search !== '') {
                $filter['$or'] = [
                    ['name'          => ['$regex' => $search, '$options' => 'i']],
                    ['email'         => ['$regex' => $search, '$options' => 'i']],
                    ['employee_code' => ['$regex' => $search, '$options' => 'i']],
                ];
            }
        }

        $total   = countDocs($employees, $filter);
        $options = ['sort' => ['employee_code' => 1, 'name' => 1]];

        if ($page !== null || $per_page !== null) {
            $pageVal    = max(1, $page ?? 1);
            $perPageVal = min(200, max(1, $per_page ?? 10));
            $options['skip']  = ($pageVal - 1) * $perPageVal;
            $options['limit'] = $perPageVal;
        }

        $docs = findMany($employees, $filter, $options);

        // For employee role: strip sensitive fields (salary, dates of birth, etc.)
        if ($isEmployee) {
            $data = array_map(function(array $doc) {
                $norm = normaliseEmployee($doc);
                // Remove sensitive financial and personal data
                unset($norm['basic_salary'], $norm['date_of_birth'], $norm['bank_account']);
                return $norm;
            }, $docs);
        } else {
            $data = array_map('normaliseEmployee', $docs);
        }

        // Sanitize all remaining MongoDB objects (like nested dates from imports)
        $data = sanitizeForJson($data);

        if ($page !== null || $per_page !== null) {
            ok([
                'employees'  => $data,
                'pagination' => [
                    'page'     => $pageVal,
                    'per_page' => $perPageVal,
                    'total'    => $total,
                    'pages'    => (int)ceil($total / $perPageVal),
                ],
            ]);
        }
        ok($data);
    }

    /* ── POST — create ───────────────────────────────────────────── */
    if ($method === 'POST' && !$id) {
        if ($currentUser['role'] !== 'hr') fail('Only HR can create employees.', 403);

        $body = empBody();

        // Validate required fields
        $missing = [];
        foreach (['employee_code', 'name', 'email', 'joining_date'] as $f) {
            if (empty($body[$f])) $missing[] = $f;
        }
        if ($missing) fail('Required fields missing: ' . implode(', ', $missing) . '.', 422);

        // Duplicate checks
        if (findOne($employees, ['employee_code' => trim($body['employee_code'])])) {
            fail('Employee code already exists.', 409);
        }
        if (findOne($employees, ['email' => strtolower(trim($body['email']))])) {
            fail('Email already exists.', 409);
        }

        // Profile image upload & compression
        $profileImage = null;
        if (!empty($_FILES['profile_image']['tmp_name'])) {
            $profileImage = processProfileImage($_FILES['profile_image']);
            // Non-fatal: if processing fails, employee is still created without a photo
        }

        $doc = [
            'employee_code'   => trim($body['employee_code']),
            'name'            => trim($body['name']),
            'email'           => strtolower(trim($body['email'])),
            'phone'           => !empty($body['phone'])       ? trim($body['phone'])       : null,
            'department'      => !empty($body['department'])  ? trim($body['department'])  : null,
            'designation'     => !empty($body['designation']) ? trim($body['designation']) : null,
            'branch'          => !empty($body['branch'])      ? trim($body['branch'])      : null,
            'employment_type' => $body['employment_type'] ?? 'full_time',
            'basic_salary'    => (float)($body['basic_salary'] ?? 0),
            'status'          => $body['status'] ?? 'active',
            'role'            => 'employee',
            'password'        => password_hash(!empty($body['password']) ? trim((string)$body['password']) : 'password123', PASSWORD_BCRYPT),
            'plain_password'  => !empty($body['password']) ? trim((string)$body['password']) : 'password123',
            'joining_date'    => !empty($body['joining_date'])
                ? new MongoDB\BSON\UTCDateTime(strtotime($body['joining_date']) * 1000) : null,
            'date_of_birth'   => !empty($body['date_of_birth'])
                ? new MongoDB\BSON\UTCDateTime(strtotime($body['date_of_birth']) * 1000) : null,
            'profile_image'   => $profileImage,
            'created_at'      => new MongoDB\BSON\UTCDateTime(),
            'updated_at'      => new MongoDB\BSON\UTCDateTime(),
        ];

        $result = insertOne($employees, $doc);
        ok(normaliseEmployee($result), 'Employee created successfully.', 201);
    }

    /* ── POST?id=... — update via FormData (_method=PUT override) ── */
    /* ── PUT?id=...  — update via JSON ─────────────────────────── */
    if (($method === 'PUT' || ($method === 'POST' && $id)) ) {
        if ($currentUser['role'] !== 'hr') fail('Only HR can update employees.', 403);
        if (!$id) fail('Employee ID required.', 400);

        $body = empBody();

        $update = [];

        // Plain string fields
        foreach (['employee_code','name','phone','department','designation','branch','employment_type','status'] as $f) {
            if (isset($body[$f]) && trim((string)$body[$f]) !== '') {
                $update[$f] = trim((string)$body[$f]);
            }
        }

        if (!empty($body['email'])) {
            $update['email'] = strtolower(trim((string)$body['email']));
        }
        if (isset($body['basic_salary']) && $body['basic_salary'] !== '') {
            $update['basic_salary'] = (float)$body['basic_salary'];
        }
        if (!empty($body['joining_date'])) {
            $update['joining_date'] = new MongoDB\BSON\UTCDateTime(strtotime($body['joining_date']) * 1000);
        }
        if (array_key_exists('date_of_birth', $body)) {
            $update['date_of_birth'] = !empty($body['date_of_birth'])
                ? new MongoDB\BSON\UTCDateTime(strtotime($body['date_of_birth']) * 1000) : null;
        }
        if (!empty($body['password'])) {
            $rawPwd = trim((string)$body['password']);
            $update['password'] = password_hash($rawPwd, PASSWORD_BCRYPT);
            $update['plain_password'] = $rawPwd;
        }

        // Profile image upload & compression — non-fatal on failure
        if (!empty($_FILES['profile_image']['tmp_name'])) {
            $processed = processProfileImage($_FILES['profile_image']);
            if ($processed) {
                $update['profile_image'] = $processed;
            }
        }

        if (!empty($body['remove_profile_image']) && empty($_FILES['profile_image']['tmp_name'])) {
            $update['profile_image'] = null;
        }

        // Allow image-only updates (no other fields changed)
        if (empty($update)) fail('No data to update.', 422);

        // Verify employee exists first
        $existing = findOne($employees, ['_id' => mongoId($id)]);
        if (!$existing) fail('Employee not found.', 404);

        $update['updated_at'] = new MongoDB\BSON\UTCDateTime();
        updateOne($employees, ['_id' => mongoId($id)], $update);

        $updated = findOne($employees, ['_id' => mongoId($id)]);
        ok(normaliseEmployee($updated), 'Employee updated successfully.');
    }

    /* ── DELETE ──────────────────────────────────────────────────── */
    if ($method === 'DELETE') {
        if ($currentUser['role'] !== 'hr') fail('Only HR can delete employees.', 403);
        if (!$id) fail('Employee ID required.', 400);

        $deleted = deleteOne($employees, ['_id' => mongoId($id)]);
        if ($deleted === 0) fail('Employee not found.', 404);

        ok(null, 'Employee deleted successfully.');
    }

    fail('Method not allowed.', 405);

} catch (Throwable $e) {
    // Re-throw clean API errors so they keep their status code
    if ($e instanceof \RuntimeException && in_array(http_response_code(), [400,401,403,404,409,422], true)) {
        throw $e;
    }
    fail($e->getMessage(), 500);
}
