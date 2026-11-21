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
    // Extract real client IP through CDN / reverse proxies (Hostinger hcdn, Cloudflare, etc.)
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_FOR'] as $h) {
        if (!empty($_SERVER[$h])) {
            $raw = (string)$_SERVER[$h];
            $parts = array_map('trim', explode(',', $raw));
            foreach ($parts as $ip) {
                if (filter_var($ip, FILTER_VALIDATE_IP)) {
                    return $ip;
                }
            }
        }
    }
    return $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
}

if (method() !== 'POST') fail('Method not allowed.', 405);

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$email = trim($body['email'] ?? '');
$password = trim($body['password'] ?? '');
$lat = (float)($body['lat'] ?? 0);
$lng = (float)($body['lng'] ?? 0);

// Production Security: Rate limit login attempts to prevent credential stuffing & brute force
$clientIp = get_client_ip();
rate_limit('login_ip', 25, 60, $clientIp);
if ($email !== '') {
    rate_limit('login_account', 10, 60, strtolower($email));
}

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

    // 1. IP brute-force protection: max 30 FAILED attempts in 15 mins from same IP (stops password attacks without blocking legitimate colleagues sharing an office network)
    $failedIpAttempts = countDocs($attemptsCol, [
        'ip' => $ip,
        'success' => false,
        'created_at' => ['$gte' => $timeLimit]
    ]);
    if ($failedIpAttempts >= 30) {
        header('Retry-After: 900');
        fail('Too many failed login attempts from this network. Please try again later.', 429);
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

    // Find user across registered companies
    $companies = get_registered_companies();
    $targetCompany = null;
    $user = null;
    $employee = null;

    foreach ($companies as $comp) {
        $compDb = mongodb()->selectDatabase($comp['db_name']);

        // 1. Check users (HR / Admins)
        $u = $compDb->selectCollection('users')->findOne(['email' => $emailLower]);
        if ($u) {
            $user = $u;
            $targetCompany = $comp;
            break;
        }

        // 2. Check employees
        $emp = $compDb->selectCollection('employees')->findOne(['email' => $emailLower]);
        if ($emp) {
            $employee = $emp;
            $targetCompany = $comp;
            break;
        }
    }

    if (!$targetCompany || (!$user && !$employee)) {
        insertOne($attemptsCol, [
            'ip' => $ip,
            'email' => $emailLower,
            'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
            'success' => false
        ]);
        fail('Invalid credentials.', 401);
    }

    // Set active company database for all subsequent operations in this request
    set_active_db_name($targetCompany['db_name']);
    $companyDb = $targetCompany['db_name'];
    $companyName = $targetCompany['name'];
    $companySlug = $targetCompany['slug'];

    $profileImage = null;

    if ($employee && !$user) {
        $employees = collection('employees');

        // Prevent deactivated employee accounts from authenticating
        if (isset($employee['status']) && $employee['status'] !== 'active') {
            insertOne($attemptsCol, [
                'ip'         => $ip,
                'email'      => $emailLower,
                'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
                'success'    => false,
                'reason'     => 'account_inactive'
            ]);
            fail('Your employee account has been deactivated. Please contact HR.', 403);
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
            'company_db' => $companyDb,
            'company_name' => $companyName,
            'company_slug' => $companySlug,
            'iat' => time(),
            'exp' => time() + (30 * 24 * 60 * 60), // 30 days
        ];
        $profileImage = $employee['profile_image'] ?? null;
    } else {
        // Prevent deactivated HR user accounts from authenticating
        if (isset($user['status']) && strtolower((string)$user['status']) === 'inactive') {
            insertOne($attemptsCol, [
                'ip'         => $ip,
                'email'      => $emailLower,
                'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
                'success'    => false,
                'reason'     => 'account_inactive'
            ]);
            fail('Your account has been deactivated. Please contact support.', 403);
        }

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
            'company_db' => $companyDb,
            'company_name' => $companyName,
            'company_slug' => $companySlug,
            'iat' => time(),
            'exp' => time() + (30 * 24 * 60 * 60), // 30 days
        ];
        $profileImage = $user['profile_image'] ?? null;
    }

    $token = create_token([
        'id' => $payload['id'],
        'name' => $payload['name'],
        'email' => $payload['email'],
        'company_db' => $companyDb,
        'company_name' => $companyName,
        'company_slug' => $companySlug,
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

        // After the check-in window closes, only send a Late Check-In Approval
        // request if the employee does NOT already have a valid attendance record
        // for today. If they already checked in earlier (e.g. at 09:55) and are
        // simply re-logging in after an accidental logout, HR should NOT receive
        // an approval request — just the regular "Employee logged in" notification.
        // For Viyana: check-in is open at any time without approval or late penalty.
        if ($companySlug !== 'viyana' && $nowTs > $checkinCloseTs) {
            $alreadyCheckedIn = findOne(collection('attendance'), [
                'employee_id' => $payload['id'],
                'date'        => $today,
                'check_in'    => ['$exists' => true, '$ne' => null, '$ne' => ''],
            ]);

            if (!$alreadyCheckedIn) {
                // Employee has NO check-in today — send approval request as before.
                $existingApproval = findOne(collection('notifications'), [
                    'role'               => 'hr',
                    'source_employee_id' => $payload['id'],
                    'event_type'         => 'attendance_approval.created',
                    'check_in_date'      => $today,
                ]);

                if (!$existingApproval) {
                    foreach ($hrs as $hr) {
                        try {
                            createNotification(
                                (string)$hr['_id'],
                                'hr',
                                'Late Check-In Approval',
                                "{$empName} logged in after the check-in deadline. Approval is required.",
                                'warning',
                                [
                                    'event_id'           => "attendance_approval:{$payload['id']}:{$today}:created",
                                    'event_type'         => 'attendance_approval.created',
                                    'source_employee_id' => $payload['id'],
                                    'source_request_id'  => "{$payload['id']}:{$today}",
                                    'speak_text'         => "{$empName} requires late check-in approval.",
                                    'check_in_date'      => $today,
                                    'check_in_time'      => $nowStr,
                                    'lat'                => $lat,
                                    'lng'                => $lng,
                                    'accuracy'           => ($body['accuracy'] ?? ''),
                                    'device'             => $device,
                                    'user_agent'         => $userAgent,
                                ]
                            );
                        } catch (Exception $e) {}
                    }
                }
            }
            // else: employee already has a check-in — this is just a re-login.
            // HR already received the "Employee logged in" notification above.
            // No approval needed.
        }

        if ($companySlug !== 'viyana' && $nowTs >= $lateAfterTs && $nowTs <= $checkinCloseTs) {
            $existingAttendance = findOne(collection('attendance'), [
                'employee_id' => $payload['id'],
                'date'        => $today,
            ]);
            if (!$existingAttendance) {
                try {
                    insertOne(collection('attendance'), [
                        'employee_id'      => $payload['id'],
                        'date'             => $today,
                        'check_in'         => $nowStr,
                        'check_out'        => null,
                        'status'           => 'late',
                        'late_minutes'     => max(1, (int)ceil(($nowTs - $lateAfterTs) / 60)),
                        'working_hours'    => null,
                        'total_break_seconds'  => 0,
                        'lunch_late_minutes'   => 0,
                        'evening_late_minutes' => 0,
                        'checkin_lat'      => $lat ?: null,
                        'checkin_lng'      => $lng ?: null,
                        'checkin_accuracy' => isset($body['accuracy']) ? substr((string)$body['accuracy'], 0, 50) : null,
                        'checkin_device'   => $device,
                        'checkin_user_agent' => substr($userAgent, 0, 500),
                        'created_at'       => date('Y-m-d H:i:s'),
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
            'company_name' => $payload['company_name'] ?? 'Worexa',
            'company_slug' => $payload['company_slug'] ?? 'worexa',
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
