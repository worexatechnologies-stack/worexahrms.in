<?php
/**
 * MongoDB Login API
 * POST /api/login-mongodb.php
 * 
 * Body:
 * {
 *   "email": "user@company.com",
 *   "password": "password",
 *   "lat": -33.8688 (optional),
 *   "lng": 151.2093 (optional)
 * }
 */

declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';
date_default_timezone_set('Asia/Kolkata');

function get_client_ip(): string
{
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        return trim($parts[0]);
    }
    return $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
}

if (method() !== 'POST') fail('Method not allowed.', 405);

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$email = trim($body['email'] ?? '');
$password = trim($body['password'] ?? '');
$lat = (float)($body['lat'] ?? 0);
$lng = (float)($body['lng'] ?? 0);

// Validate input
if (!$email || !$password) {
    fail('Email and password required.', 400);
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fail('Invalid email format.', 400);
}

$ip = get_client_ip();
$emailLower = strtolower($email);

try {
    $attemptsCol = collection('login_attempts');
    $timeLimit = new MongoDB\BSON\UTCDateTime((time() - 900) * 1000); // 15 mins ago

    // 1. IP block: max 20 total attempts in 15 mins
    $totalIpAttempts = countDocs($attemptsCol, [
        'ip' => $ip,
        'created_at' => ['$gte' => $timeLimit]
    ]);
    if ($totalIpAttempts >= 20) {
        header('Retry-After: 900');
        fail('Too many requests. Please try again later.', 429);
    }

    // 2. Failed attempts block: max 5 failed attempts in 15 mins for same email
    $failedAttempts = countDocs($attemptsCol, [
        'email' => $emailLower,
        'success' => false,
        'created_at' => ['$gte' => $timeLimit]
    ]);
    if ($failedAttempts >= 5) {
        header('Retry-After: 900');
        fail('Too many failed login attempts. Please try again in 15 minutes.', 429);
    }

    $users = collection('users');
    
    // Find user by email
    $user = findOne($users, ['email' => $emailLower]);
    
    $profileImage = null;
    $employee = null;

    if (!$user) {
        // Also check employees table (they can login as employees)
        $employees = collection('employees');
        $employee = findOne($employees, ['email' => $emailLower]);
        
        if (!$employee) {
            insertOne($attemptsCol, [
                'ip' => $ip,
                'email' => $emailLower,
                'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
                'success' => false
            ]);
            fail('Invalid credentials.', 401);
        }
        
        // Verify password
        if (!password_verify($password, $employee['password'] ?? '')) {
            insertOne($attemptsCol, [
                'ip' => $ip,
                'email' => $emailLower,
                'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
                'success' => false
            ]);
            fail('Invalid credentials.', 401);
        }
        
        // Generate JWT for employee
        $payload = [
            'id' => (string)$employee['_id'],
            'email' => $employee['email'],
            'name' => $employee['name'],
            'role' => $employee['role'] ?? 'employee',
            'type' => 'employee',
            'iat' => time(),
            'exp' => time() + (30 * 24 * 60 * 60), // 30 days
        ];
        $profileImage = $employee['profile_image'] ?? null;
    } else {
        // Verify password
        if (!password_verify($password, $user['password'] ?? '')) {
            insertOne($attemptsCol, [
                'ip' => $ip,
                'email' => $emailLower,
                'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
                'success' => false
            ]);
            fail('Invalid credentials.', 401);
        }
        
        // Generate JWT for HR user
        $payload = [
            'id' => (string)$user['_id'],
            'email' => $user['email'],
            'name' => $user['name'],
            'role' => $user['role'] ?? 'hr',
            'type' => 'user',
            'iat' => time(),
            'exp' => time() + (30 * 24 * 60 * 60), // 30 days
        ];
        $profileImage = $user['profile_image'] ?? null;
    }
    
    $token = create_token([
        'id' => $payload['id'],
        'name' => $payload['name'],
        'email' => $payload['email']
    ], $payload['role']);
    set_auth_cookie($token);
    
    // Log success
    insertOne($attemptsCol, [
        'ip' => $ip,
        'email' => $emailLower,
        'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
        'success' => true
    ]);

    // If it's an employee logging in, track location & device, and notify HR
    if ($payload['role'] === 'employee') {
        $today = date('Y-m-d');
        $nowStr = date('H:i:s');
        $nowTs = strtotime($nowStr);
        $lateAfterTs = strtotime('09:45:00');
        $checkinCloseTs = strtotime('10:00:00');
        $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '';
        
        // Parse device summary
        $device = 'Unknown device';
        foreach (['Android', 'iPhone', 'iPad', 'Windows', 'Mac', 'Linux'] as $kw) {
            if (stripos($userAgent, $kw) !== false) {
                $device = $kw . ' device';
                break;
            }
        }

        $sessionId = trim((string)($body['session_id'] ?? ''));
        if ($sessionId === '') {
            $sessionId = $payload['id'] . '_' . str_replace('-', '', $today);
        }

        $empName = $payload['name'] ?? 'Employee';
        $message = "{$empName} logged in.";
        $speak = "{$empName} has logged in.";
        
        // Notify all HR users
        $hrs = findMany(collection('users'), ['role' => 'hr']);
        foreach ($hrs as $hr) {
            try {
                createNotification(
                    (string)$hr['_id'],
                    'hr',
                    'Employee Login',
                    $message,
                    'info',
                    [
                        'event_id' => 'login:' . $sessionId . ':success:hr:' . (string)$hr['_id'],
                        'event_type' => 'employee_login.created',
                        'source_employee_id' => $payload['id'],
                        'speak_text' => $speak,
                        'login_date' => $today,
                        'login_time' => $nowStr,
                        'lat' => $lat,
                        'lng' => $lng,
                        'accuracy' => ($body['accuracy'] ?? ''),
                        'device' => $device,
                        'user_agent' => $userAgent
                    ]
                );
            } catch (Exception $e) {}
        }

        if ($nowTs >= $lateAfterTs && $nowTs <= $checkinCloseTs) {
            $existingAttendance = findOne(collection('attendance'), [
                'employee_id' => $payload['id'],
                'date' => $today,
            ]);
            if (!$existingAttendance) {
                try {
                    insertOne(collection('attendance'), [
                        'employee_id' => $payload['id'],
                        'date' => $today,
                        'check_in' => $nowStr,
                        'check_out' => null,
                        'status' => 'late',
                        'late_minutes' => max(1, (int)ceil(($nowTs - $lateAfterTs) / 60)),
                        'working_hours' => null,
                        'total_break_seconds' => 0,
                        'lunch_late_minutes' => 0,
                        'evening_late_minutes' => 0,
                        'checkin_lat' => $lat ?: null,
                        'checkin_lng' => $lng ?: null,
                        'checkin_accuracy' => isset($body['accuracy']) ? substr((string)$body['accuracy'], 0, 50) : null,
                        'checkin_device' => $device,
                        'checkin_user_agent' => substr($userAgent, 0, 500),
                        'created_at' => date('Y-m-d H:i:s'),
                    ]);
                } catch (Exception $e) {}
            }
        }
    }

    $soundEnabled = true;
    $voiceEnabled = true;
    $voiceVolume = 0.8;
    $selectedVoice = '';
    if ($payload['role'] === 'employee') {
        $soundEnabled = $employee['sound_enabled'] ?? true;
        $voiceEnabled = $employee['voice_enabled'] ?? true;
        $voiceVolume = isset($employee['voice_volume']) ? (float)$employee['voice_volume'] : 0.8;
        $selectedVoice = $employee['selected_voice'] ?? '';
    } else {
        $soundEnabled = $user['sound_enabled'] ?? true;
        $voiceEnabled = $user['voice_enabled'] ?? true;
        $voiceVolume = isset($user['voice_volume']) ? (float)$user['voice_volume'] : 0.8;
        $selectedVoice = $user['selected_voice'] ?? '';
    }

    ok([
        'user' => [
            'id' => $payload['id'],
            'name' => $payload['name'],
            'email' => $payload['email'],
            'role' => $payload['role'],
            'profile_image' => $profileImage,
            'sound_enabled' => $soundEnabled,
            'voice_enabled' => $voiceEnabled,
            'voice_volume' => $voiceVolume,
            'selected_voice' => $selectedVoice,
        ],
    ]);
    
} catch (Throwable $e) {
    if ($e->getCode() === 429 || $e->getCode() === 401 || $e->getCode() === 400) {
        throw $e;
    }
    fail("Login failed: " . $e->getMessage(), 500);
}
?>
