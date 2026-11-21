<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

// Verify the request is authenticated (any role can read; HR only for writes)
$currentUser = current_user();

$method = method();
$id     = $_GET['id'] ?? '';

// Helper: normalise a MongoDB doc for JSON output
function normaliseEmployee(array $doc, bool $useAvatarUrl = false): array
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

    // Convert heavy inline Base64 profile_image into a lightweight HTTP avatar endpoint URL
    if ($useAvatarUrl && !empty($doc['profile_image']) && !empty($doc['id'])) {
        $doc['profile_image'] = "employees.php?action=avatar&id=" . $doc['id'];
    }

    // Never expose password hashes, plaintext passwords or current_password
    unset($doc['password'], $doc['plain_password'], $doc['current_password']);
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

/** Parse supported structured employee profile groups from multipart or JSON input. */
function employeeProfileGroups(array $body): array
{
    $groups = ['personal_profile', 'emergency_contact', 'employment_details', 'compensation_details', 'it_profile'];
    $result = [];
    foreach ($groups as $group) {
        $value = $body[$group] ?? null;
        if (is_string($value)) $value = json_decode($value, true);
        if (!is_array($value)) continue;
        $clean = [];
        foreach ($value as $key => $item) {
            if (!preg_match('/^[a-z][a-z0-9_]{0,49}$/i', (string)$key)) continue;
            if (is_array($item) || is_object($item)) continue;
            $clean[$key] = is_string($item) ? trim($item) : $item;
        }
        $result[$group] = $clean;
    }
    return $result;
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
    // Validate image format via getimagesize
    $imgSize = @getimagesize($tmpPath);
    if (!$imgSize) {
        return null; // Not a valid image file
    }

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
        // Special action: debug image upload capabilities (restricted to HR)
        if (isset($_GET['action']) && $_GET['action'] === 'debug_image') {
            if (($currentUser['role'] ?? '') !== 'hr') fail('Unauthorized.', 403);
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

        // Special action: serve cached binary image for an employee avatar
        if (isset($_GET['action']) && $_GET['action'] === 'avatar') {
            $avatarId = trim((string)($_GET['id'] ?? ''));
            if ($avatarId === '') fail('ID required.', 400);

            $isMongoId = preg_match('/^[a-f\d]{24}$/i', $avatarId);
            $qId = $isMongoId ? mongoId($avatarId) : (int)$avatarId;
            $empDoc = findOne($employees, ['_id' => $qId], ['projection' => ['profile_image' => 1]]);
            if (!$empDoc || empty($empDoc['profile_image'])) {
                http_response_code(404);
                exit;
            }

            $raw = (string)$empDoc['profile_image'];
            if (str_starts_with($raw, 'data:')) {
                if (preg_match('/^data:(image\/[a-zA-Z0-9\+\-\.]+);base64,(.*)$/', $raw, $matches)) {
                    $mime = $matches[1];
                    $bytes = base64_decode($matches[2]);
                    $etag = '"' . md5($bytes) . '"';

                    header("Content-Type: {$mime}");
                    header('Cache-Control: public, max-age=86400, stale-while-revalidate=604800');
                    header("ETag: {$etag}");

                    if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim($_SERVER['HTTP_IF_NONE_MATCH']) === $etag) {
                        http_response_code(304);
                        exit;
                    }

                    header('Content-Length: ' . (string)strlen($bytes));
                    echo $bytes;
                    exit;
                }
            }

            $filePath = __DIR__ . '/' . ltrim($raw, '/');
            if (file_exists($filePath) && is_file($filePath)) {
                $mime = mime_content_type($filePath) ?: 'image/jpeg';
                header("Content-Type: {$mime}");
                header('Cache-Control: public, max-age=86400');
                readfile($filePath);
                exit;
            }

            http_response_code(404);
            exit;
        }

        $pageInput    = $_GET['page'] ?? null;
        $limitInput   = $_GET['limit'] ?? ($_GET['per_page'] ?? null);
        $status       = $_GET['status']     ?? '';
        $department   = $_GET['department'] ?? '';
        $search       = trim((string)($_GET['search'] ?? ''));
        $mode         = $_GET['mode'] ?? '';

        // Employees can only view active employees in directory mode
        $isEmployee = ($currentUser['role'] !== 'hr');
        if ($isEmployee && $status === '') {
            $status = 'active';
        }

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
                    ['designation'   => ['$regex' => $search, '$options' => 'i']],
                ];
            }
        }

        // Single employee lookup
        if ($id !== '') {
            $empDoc = findOne($employees, $filter);
            if (!$empDoc) {
                fail('Employee not found.', 404);
            }
            $singleNorm = normaliseEmployee($empDoc, true);
            if ($isEmployee) {
                unset($singleNorm['basic_salary'], $singleNorm['compensation_details']);
                if ($singleNorm['id'] !== ($currentUser['id'] ?? '')) {
                    unset($singleNorm['personal_profile'], $singleNorm['emergency_contact'], $singleNorm['employment_details'], $singleNorm['it_profile'], $singleNorm['date_of_birth'], $singleNorm['phone']);
                }
            }
            ok(sanitizeForJson($singleNorm));
        }

        $total = countDocs($employees, $filter);
        // Deterministic sorting
        $options = ['sort' => ['name' => 1, 'employee_code' => 1]];

        // Field projection for directory mode / employee view: never fetch confidential details
        $isDirMode = $isEmployee || ($mode === 'directory');
        if ($isDirMode) {
            $options['projection'] = [
                '_id'             => 1,
                'employee_code'   => 1,
                'name'            => 1,
                'email'           => 1,
                'phone'           => 1,
                'department'      => 1,
                'designation'     => 1,
                'branch'          => 1,
                'employment_type' => 1,
                'status'          => 1,
                'joining_date'    => 1,
                'profile_image'   => 1,
                'role'            => 1,
            ];
        }

        $isPaginated = ($pageInput !== null || $limitInput !== null || $isDirMode);

        if ($isPaginated) {
            $pageVal = max(1, (int)($pageInput ?? 1));
            // Allowed page sizes: 25, 50, 100; default 25; clamp maximum to 100
            $allowedLimits = [25, 50, 100];
            $rawLimit = (int)($limitInput ?? 25);
            $limitVal = in_array($rawLimit, $allowedLimits, true) ? $rawLimit : min(100, max(1, $rawLimit));

            $options['skip']  = ($pageVal - 1) * $limitVal;
            $options['limit'] = $limitVal;
        }

        $docs = findMany($employees, $filter, $options);

        // Transform documents and ensure zero credential exposure + lightweight avatar endpoint
        $data = array_map(function(array $doc) use ($isEmployee) {
            $norm = normaliseEmployee($doc, true);
            if ($isEmployee) {
                unset($norm['basic_salary'], $norm['date_of_birth'], $norm['bank_account']);
            }
            return $norm;
        }, $docs);

        $data = sanitizeForJson($data);

        if ($isPaginated) {
            $hasMore = ($pageVal * $limitVal) < $total;
            ok([
                'employees'  => $data,
                'pagination' => [
                    'page'     => $pageVal,
                    'limit'    => $limitVal,
                    'per_page' => $limitVal,
                    'total'    => $total,
                    'pages'    => (int)ceil($total / max(1, $limitVal)),
                    'hasMore'  => $hasMore,
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
            'password'        => password_hash(!empty($body['password']) ? trim((string)$body['password']) : 'password123', PASSWORD_DEFAULT),
            'joining_date'    => !empty($body['joining_date'])
                ? new MongoDB\BSON\UTCDateTime(strtotime($body['joining_date']) * 1000) : null,
            'date_of_birth'   => !empty($body['date_of_birth'])
                ? new MongoDB\BSON\UTCDateTime(strtotime($body['date_of_birth']) * 1000) : null,
            'profile_image'   => $profileImage,
            'created_at'      => new MongoDB\BSON\UTCDateTime(),
            'updated_at'      => new MongoDB\BSON\UTCDateTime(),
        ];
        foreach (employeeProfileGroups($body) as $group => $value) $doc[$group] = $value;

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
        foreach (employeeProfileGroups($body) as $group => $value) $update[$group] = $value;

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
            $update['password'] = password_hash($rawPwd, PASSWORD_DEFAULT);
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
