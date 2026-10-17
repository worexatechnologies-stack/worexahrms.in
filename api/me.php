<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
$user = current_user();

if (method() === 'PUT') {
    $body = input();
    $updateData = [];
    if (array_key_exists('sound_enabled', $body)) {
        $updateData['sound_enabled'] = $body['sound_enabled'] ? true : false;
        $user['sound_enabled'] = $updateData['sound_enabled'];
    }
    if (array_key_exists('voice_enabled', $body)) {
        $updateData['voice_enabled'] = $body['voice_enabled'] ? true : false;
        $user['voice_enabled'] = $updateData['voice_enabled'];
    }
    if (array_key_exists('voice_volume', $body)) {
        $updateData['voice_volume'] = (float) $body['voice_volume'];
        $user['voice_volume'] = $updateData['voice_volume'];
    }
    if (array_key_exists('selected_voice', $body)) {
        $updateData['selected_voice'] = trim((string) $body['selected_voice']);
        $user['selected_voice'] = $updateData['selected_voice'];
    }

    if (!empty($updateData)) {
        if (($user['role'] ?? '') === 'hr') {
            updateOne(collection('users'), ['_id' => mongoId($user['id'])], $updateData);
        } else {
            updateOne(collection('employees'), ['_id' => mongoId($user['id'])], $updateData);
        }
    }
}

unset($user['_id'], $user['password']);
ok([
    'id' => (string)($user['id'] ?? ''),
    'name' => $user['name'] ?? '',
    'email' => $user['email'] ?? '',
    'role' => $user['role'] ?? '',
    'company_name' => $user['company_name'] ?? 'Worexa',
    'company_slug' => $user['company_slug'] ?? 'worexa',
    'profile_image' => $user['profile_image'] ?? null,
    'branch' => $user['branch'] ?? null,
    'sound_enabled' => $user['sound_enabled'] ?? true,
    'voice_enabled' => $user['voice_enabled'] ?? true,
    'voice_volume' => isset($user['voice_volume']) ? (float)$user['voice_volume'] : 0.8,
    'selected_voice' => $user['selected_voice'] ?? '',
]);
