<?php
/**
 * WebAuthn (Face ID / Fingerprint) API
 * 
 * GET  ?action=challenge          — Generate a registration/auth challenge
 * POST ?action=register           — Store a new WebAuthn credential
 * POST ?action=authenticate       — Verify a WebAuthn assertion and login
 * DELETE ?action=remove           — Remove a stored credential
 * GET  ?action=has_credential     — Check if user has a stored credential
 */

declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
date_default_timezone_set('Asia/Kolkata');

$action = $_GET['action'] ?? '';

// ── GET: Generate challenge ──────────────────────────────────────
if (method() === 'GET' && $action === 'challenge') {
    $challenge = base64_encode(random_bytes(32));
    
    // Store challenge in a temp collection with TTL
    $col = collection('webauthn_challenges');
    insertOne($col, [
        'challenge' => $challenge,
        'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
        'expires_at' => new MongoDB\BSON\UTCDateTime((time() + 300) * 1000), // 5 min TTL
    ]);
    
    ok([
        'challenge' => $challenge,
        'rp' => [
            'name' => 'WOREXA HRMS',
            'id' => $_SERVER['HTTP_HOST'] ?? 'localhost',
        ],
        'timeout' => 60000,
    ]);
}

// ── GET: Check if user has stored credentials ────────────────────
if (method() === 'GET' && $action === 'has_credential') {
    $email = trim($_GET['email'] ?? '');
    if (!$email) fail('Email required.', 400);
    
    $cred = findOne(collection('webauthn_credentials'), ['email' => strtolower($email)]);
    ok(['has_credential' => !!$cred]);
}

// ── POST: Register new credential ───────────────────────────────
if (method() === 'POST' && $action === 'register') {
    $user = authUser();
    if (!$user) fail('Authentication required.', 401);
    
    $body = input();
    $credentialId = $body['credential_id'] ?? '';
    $publicKey = $body['public_key'] ?? '';
    $challenge = $body['challenge'] ?? '';
    
    if (!$credentialId || !$publicKey || !$challenge) {
        fail('Missing credential data.', 400);
    }
    
    // Verify challenge exists
    $challengeDoc = findOne(collection('webauthn_challenges'), ['challenge' => $challenge]);
    if (!$challengeDoc) {
        fail('Invalid or expired challenge.', 400);
    }
    
    // Delete used challenge
    collection('webauthn_challenges')->deleteOne(['challenge' => $challenge]);
    
    // Store credential (upsert — one credential per user)
    $col = collection('webauthn_credentials');
    $existing = findOne($col, ['user_id' => $user['id']]);
    
    $credData = [
        'user_id' => $user['id'],
        'email' => strtolower($user['email']),
        'credential_id' => $credentialId,
        'public_key' => $publicKey,
        'device_name' => $body['device_name'] ?? 'Unknown Device',
        'created_at' => new MongoDB\BSON\UTCDateTime(time() * 1000),
        'last_used_at' => null,
    ];
    
    if ($existing) {
        updateOne($col, ['user_id' => $user['id']], ['$set' => $credData]);
    } else {
        insertOne($col, $credData);
    }
    
    ok(null, 'Biometric credential registered successfully.');
}

// ── POST: Authenticate with credential ──────────────────────────
if (method() === 'POST' && $action === 'authenticate') {
    $body = input();
    $credentialId = $body['credential_id'] ?? '';
    $challenge = $body['challenge'] ?? '';
    $email = strtolower(trim($body['email'] ?? ''));
    
    if (!$credentialId || !$challenge || !$email) {
        fail('Missing authentication data.', 400);
    }
    
    // Verify challenge exists
    $challengeDoc = findOne(collection('webauthn_challenges'), ['challenge' => $challenge]);
    if (!$challengeDoc) {
        fail('Invalid or expired challenge.', 400);
    }
    collection('webauthn_challenges')->deleteOne(['challenge' => $challenge]);
    
    // Find stored credential
    $cred = findOne(collection('webauthn_credentials'), [
        'email' => $email,
        'credential_id' => $credentialId,
    ]);
    
    if (!$cred) {
        fail('Biometric credential not found. Please login with password.', 401);
    }
    
    // Look up user
    $user = findOne(collection('users'), ['email' => $email]);
    if (!$user) {
        $employee = findOne(collection('employees'), ['email' => $email]);
        if (!$employee) {
            fail('User not found.', 401);
        }
        // Build user from employee
        $userId = (string)$employee['_id'];
        $userData = [
            'id' => $userId,
            'name' => $employee['name'] ?? '',
            'email' => $employee['email'],
            'role' => 'employee',
            'department' => $employee['department'] ?? '',
            'profile_image' => $employee['profile_image'] ?? null,
        ];
    } else {
        $userId = (string)$user['_id'];
        $userData = [
            'id' => $userId,
            'name' => $user['name'] ?? '',
            'email' => $user['email'],
            'role' => $user['role'] ?? 'employee',
            'department' => $user['department'] ?? '',
            'profile_image' => $user['profile_image'] ?? null,
        ];
    }
    
    // Update last used
    updateOne(collection('webauthn_credentials'), [
        'email' => $email,
        'credential_id' => $credentialId,
    ], ['$set' => ['last_used_at' => new MongoDB\BSON\UTCDateTime(time() * 1000)]]);
    
    // Create JWT session (same as login.php)
    $secret = getenv('HRMS_JWT_SECRET') ?: 'change-this-secret-before-production';
    $payload = [
        'sub' => $userId,
        'email' => $email,
        'role' => $userData['role'],
        'iat' => time(),
        'exp' => time() + 86400 * 7,
    ];
    
    $header = base64_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $payloadB64 = base64_encode(json_encode($payload));
    $signature = base64_encode(hash_hmac('sha256', "$header.$payloadB64", $secret, true));
    $token = "$header.$payloadB64.$signature";
    
    $cookieOptions = [
        'expires' => time() + 86400 * 7,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => isset($_SERVER['HTTPS']),
    ];
    setcookie('hrms_token', $token, $cookieOptions);
    
    ok(['user' => $userData], 'Biometric login successful.');
}

// ── DELETE: Remove credential ───────────────────────────────────
if (method() === 'DELETE' && $action === 'remove') {
    $user = authUser();
    if (!$user) fail('Authentication required.', 401);
    
    collection('webauthn_credentials')->deleteMany(['user_id' => $user['id']]);
    ok(null, 'Biometric credential removed.');
}

fail('Invalid action.', 400);
