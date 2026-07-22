<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$currentUser = current_user();
rate_limit('team-chat:' . method(), method() === 'GET' ? 120 : 60, 60, $currentUser['id'] ?? '');
$method = method();
$action = $_GET['action'] ?? 'messages';

function chatBody(): array
{
    return json_decode(file_get_contents('php://input') ?: '', true) ?? [];
}

function currentUserId(array $user): string
{
    return (string)($user['id'] ?? $user['_id'] ?? '');
}

function conversationEmployeeId(string $conversationId): string
{
    if (preg_match('/^hr-employee-(.+)$/', $conversationId, $m)) {
        return $m[1];
    }
    return '';
}

function ensureConversationAccess(array $user, string $conversationId): string
{
    $userId = currentUserId($user);

    if (preg_match('/^hr-employee-(.+)$/', $conversationId, $m)) {
        $employeeId = $m[1];
        if (($user['role'] ?? '') === 'hr') return $employeeId;
        if (($user['role'] ?? '') === 'employee' && $employeeId === $userId) return $employeeId;
    }

    if (preg_match('/^employee-employee-([a-f0-9]{24})-([a-f0-9]{24})$/', $conversationId, $m)) {
        if (($user['role'] ?? '') === 'employee' && ($m[1] === $userId || $m[2] === $userId)) return $conversationId;
    }

    fail('You do not have access to this conversation.', 403);
}

function callRoomId(): string
{
    return 'call_' . bin2hex(random_bytes(8)) . '_' . time();
}

function ensureCallRoomAccess(array $user, string $roomId): array
{
    $room = findOne(collection('team_call_rooms'), ['room_id' => $roomId]);
    if (!$room) fail('Call room not found.', 404);
    if ((string)($room['host_id'] ?? '') === currentUserId($user)) return $room;
    if (($user['role'] ?? '') === 'hr') return $room;

    $participants = $room['participant_ids'] ?? [];
    if (($user['role'] ?? '') === 'employee' && in_array(currentUserId($user), $participants, true)) {
        return $room;
    }

    fail('You do not have access to this call room.', 403);
}

function ensureTeamRoomAccess(array $user, string $roomId): array
{
    if (!preg_match('/^[a-f\d]{24}$/i', $roomId)) {
        fail('Chat room not found.', 404);
    }

    $room = findOne(collection('chat_rooms'), ['_id' => mongoId($roomId)]);
    if (!$room) fail('Chat room not found.', 404);
    
    $role = trim(strtolower((string)($user['role'] ?? '')));
    $designation = trim(strtolower((string)($user['designation'] ?? '')));
    
    if ($role === 'hr' || $role === 'ceo' || $designation === 'ceo') {
        return $room;
    }
    
    if ($role === 'employee') {
        $userDept = trim(strtolower((string)($user['department'] ?? '')));
        $roomDept = trim(strtolower((string)($room['department'] ?? '')));
        if ($userDept === $roomDept) {
            return $room;
        }
    }
    
    fail('You do not have access to this team chat room.', 403);
}

function normaliseCallRoom(array $doc): array
{
    $created = $doc['created_at'] ?? null;
    if ($created instanceof MongoDB\BSON\UTCDateTime) {
        $created = $created->toDateTime()
            ->setTimezone(new DateTimeZone('Asia/Kolkata'))
            ->format(DateTimeInterface::ATOM);
    }

    return [
        'room_id' => (string)($doc['room_id'] ?? ''),
        'mode' => (string)($doc['mode'] ?? 'private'),
        'title' => (string)($doc['title'] ?? 'Team Call'),
        'host_id' => (string)($doc['host_id'] ?? ''),
        'host_name' => (string)($doc['host_name'] ?? ''),
        'conversation_id' => (string)($doc['conversation_id'] ?? ''),
        'participant_ids' => $doc['participant_ids'] ?? [],
        'participant_names' => $doc['participant_names'] ?? [],
        'created_at' => $created ?: '',
    ];
}

function normaliseChatMessage(array $doc): array
{
    $created = $doc['created_at'] ?? null;
    if ($created instanceof MongoDB\BSON\UTCDateTime) {
        $created = $created->toDateTime()
            ->setTimezone(new DateTimeZone('Asia/Kolkata'))
            ->format(DateTimeInterface::ATOM);
    }

    return [
        'id' => (string)($doc['_id'] ?? ''),
        'conversation_id' => (string)($doc['conversation_id'] ?? ''),
        'author_id' => (string)($doc['author_id'] ?? ''),
        'author' => (string)($doc['author'] ?? ''),
        'role' => (string)($doc['role'] ?? ''),
        'text' => (string)($doc['text'] ?? ''),
        'attachments' => plainSignalPayload($doc['attachments'] ?? []),
        'reply_to' => plainSignalPayload($doc['reply_to'] ?? null),
        'edited' => !empty($doc['edited']),
        'reactions' => plainSignalPayload($doc['reactions'] ?? []),
        'status' => (string)($doc['status'] ?? 'sent'),
        'created_at' => $created ?: '',
    ];
}

function notifyChatRecipients(array $currentUser, string $conversationId, array $message): void
{
    $senderId = currentUserId($currentUser);
    $senderName = (string)($currentUser['name'] ?? 'User');
    $text = trim((string)($message['text'] ?? ''));
    $preview = $text !== '' ? substr($text, 0, 120) : 'Sent an attachment';

    $targets = [];

    if (preg_match('/^hr-employee-(.+)$/', $conversationId, $m)) {
        $employeeId = $m[1];
        if (($currentUser['role'] ?? '') === 'hr') {
            $targets[] = ['user_id' => $employeeId, 'role' => 'employee'];
        } else {
            $hrs = findMany(collection('users'), ['role' => 'hr']);
            foreach ($hrs as $hr) {
                $targets[] = ['user_id' => (string)($hr['_id'] ?? $hr['id'] ?? ''), 'role' => 'hr'];
            }
        }
    } elseif (preg_match('/^employee-employee-([a-f0-9]{24})-([a-f0-9]{24})$/', $conversationId, $m)) {
        $otherId = $m[1] === $senderId ? $m[2] : $m[1];
        $targets[] = ['user_id' => $otherId, 'role' => 'employee'];
    }

    foreach ($targets as $target) {
        if (($target['user_id'] ?? '') === '' || $target['user_id'] === $senderId) continue;
        try {
            insertOne(collection('notifications'), [
                'user_id' => $target['user_id'],
                'role' => $target['role'],
                'title' => 'New Team Chat Message',
                'message' => "conversation_id={$conversationId};sender={$senderName}; {$senderName}: {$preview}",
                'type' => 'info',
                'is_read' => false,
                'is_cleared' => false,
                'created_at' => new MongoDB\BSON\UTCDateTime(),
            ]);
        } catch (Exception) {}
    }
}

function normaliseCallStatus(?array $doc): array
{
    if (!$doc) return ['status' => 'idle', 'user' => '', 'updated_at' => ''];

    $updated = $doc['updated_at'] ?? null;
    if ($updated instanceof MongoDB\BSON\UTCDateTime) {
        $updated = $updated->toDateTime()
            ->setTimezone(new DateTimeZone('Asia/Kolkata'))
            ->format(DateTimeInterface::ATOM);
    }

    return [
        'conversation_id' => (string)($doc['conversation_id'] ?? ''),
        'room_id' => (string)($doc['room_id'] ?? ''),
        'status' => (string)($doc['status'] ?? 'idle'),
        'user' => (string)($doc['user'] ?? ''),
        'user_id' => (string)($doc['user_id'] ?? ''),
        'updated_at' => $updated ?: '',
    ];
}

function normalisePresence(array $doc): array
{
    $updated = $doc['updated_at'] ?? null;
    if ($updated instanceof MongoDB\BSON\UTCDateTime) {
        $updated = $updated->toDateTime()
            ->setTimezone(new DateTimeZone('Asia/Kolkata'))
            ->format(DateTimeInterface::ATOM);
    }

    return [
        'room_id' => (string)($doc['room_id'] ?? ''),
        'user_id' => (string)($doc['user_id'] ?? ''),
        'name' => (string)($doc['name'] ?? ''),
        'role' => (string)($doc['role'] ?? ''),
        'active' => !empty($doc['active']),
        'updated_at' => $updated ?: '',
    ];
}

function plainSignalPayload(mixed $value): mixed
{
    if ($value instanceof MongoDB\Model\BSONDocument || $value instanceof MongoDB\Model\BSONArray) {
        $value = $value->getArrayCopy();
    }
    if (is_object($value)) {
        $value = (array)$value;
    }
    if (is_array($value)) {
        $out = [];
        foreach ($value as $key => $item) {
            $out[$key] = plainSignalPayload($item);
        }
        return $out;
    }
    return $value;
}

function normaliseSignal(array $doc): array
{
    return [
        'id' => (string)($doc['_id'] ?? ''),
        'room_id' => (string)($doc['room_id'] ?? ''),
        'from_user_id' => (string)($doc['from_user_id'] ?? ''),
        'from_name' => (string)($doc['from_name'] ?? ''),
        'to_user_id' => (string)($doc['to_user_id'] ?? ''),
        'type' => (string)($doc['type'] ?? ''),
        'payload' => plainSignalPayload($doc['payload'] ?? null),
    ];
}

function teamRoomName(string $department): string
{
    return trim($department) . ' Team';
}

function syncDepartmentChatRooms(): void
{
    $baseDepartments = ['IT', 'HR', 'SEO', 'Social Media', 'BDE', 'Accounting', 'Sales'];
    $employees = findMany(collection('employees'), ['status' => 'active']);
    $departments = [];

    foreach ($baseDepartments as $dept) {
        $dept = trim($dept);
        if ($dept !== '') $departments[strtolower($dept)] = $dept;
    }

    foreach ($employees as $employee) {
        $dept = trim((string)($employee['department'] ?? ''));
        if ($dept !== '') $departments[strtolower($dept)] = $dept;
    }

    deleteMany(collection('chat_rooms'), ['department' => ['$in' => ['Developers', 'Design']]]);

    foreach ($departments as $department) {
        $room = findOne(collection('chat_rooms'), [
            'department' => ['$regex' => '^' . preg_quote($department, '/') . '$', '$options' => 'i'],
        ]);

        $data = [
            'name' => teamRoomName($department),
            'department' => $department,
            'type' => 'department',
            'hr_included' => true,
        ];

        if ($room) {
            if (($room['name'] ?? '') !== $data['name'] || ($room['department'] ?? '') !== $data['department']) {
                updateOne(collection('chat_rooms'), ['_id' => $room['_id']], $data + ['updated_at' => date('Y-m-d H:i:s')]);
            }
        } else {
            insertOne(collection('chat_rooms'), $data + ['created_at' => date('Y-m-d H:i:s')]);
        }
    }
}

try {
    $messages = collection('team_chat_messages');
    $calls = collection('team_call_status');
    $rooms = collection('team_call_rooms');
    $presence = collection('team_call_presence');
    $signals = collection('team_call_signals');

    if ($action === 'messages' && $method === 'GET') {
        $conversationId = trim($_GET['conversation_id'] ?? '');
        ensureConversationAccess($currentUser, $conversationId);

        $limit = min(30, max(10, (int)($_GET['limit'] ?? 30)));
        $filter = ['conversation_id' => $conversationId];

        // Cursor-based pagination: load messages older than given ID
        $before = trim($_GET['before'] ?? '');
        if ($before !== '') {
            try {
                $filter['_id'] = ['$lt' => mongoId($before)];
            } catch (Exception) {}
        }

        $docs = findMany($messages, $filter, [
            'sort'  => ['created_at' => -1],
            'limit' => $limit,
        ]);
        $data = array_reverse(array_map('normaliseChatMessage', $docs));
        ok(['messages' => $data, 'has_more' => count($data) === $limit]);
    }

    if ($action === 'message' && $method === 'POST') {
        $body = chatBody();
        $conversationId = trim((string)($body['conversation_id'] ?? ''));
        ensureConversationAccess($currentUser, $conversationId);

        $text = trim((string)($body['text'] ?? ''));
        $attachments = $body['attachments'] ?? [];
        if (!is_array($attachments)) $attachments = [];
        $attachments = array_slice(array_map(function ($item) {
            return [
                'name' => trim((string)($item['name'] ?? 'Attachment')),
                'type' => trim((string)($item['type'] ?? 'application/octet-stream')),
                'size' => (int)($item['size'] ?? 0),
            ];
        }, $attachments), 0, 10);
        if ($text === '' && count($attachments) === 0) fail('Message is required.', 422);
        if (strlen($text) > 1000) fail('Message is too long.', 422);

        $doc = [
            'conversation_id' => $conversationId,
            'author_id' => currentUserId($currentUser),
            'author' => (string)($currentUser['name'] ?? 'User'),
            'role' => (string)($currentUser['role'] ?? ''),
            'text' => $text,
            'attachments' => $attachments,
            'reply_to' => $body['reply_to'] ?? null,
            'edited' => false,
            'reactions' => [],
            'status' => 'sent',
            'created_at' => new MongoDB\BSON\UTCDateTime(),
        ];
        $saved = insertOne($messages, $doc);
        notifyChatRecipients($currentUser, $conversationId, $saved);
        ok(normaliseChatMessage($saved), 'Message sent.', 201);
    }

    if ($action === 'rooms' && $method === 'GET') {
        if (($currentUser['role'] ?? '') === 'hr') {
            $docs = findMany($rooms, ['host_id' => currentUserId($currentUser)], [
                'sort' => ['created_at' => -1],
                'limit' => 20,
            ]);
        } else {
            $docs = findMany($rooms, ['$or' => [
                ['host_id' => currentUserId($currentUser)],
                ['participant_ids' => currentUserId($currentUser)],
            ]], [
                'sort' => ['created_at' => -1],
                'limit' => 20,
            ]);
        }
        ok(['rooms' => array_map('normaliseCallRoom', $docs)]);
    }

    if ($action === 'invite' && $method === 'POST') {
        $body = chatBody();
        $mode = (string)($body['mode'] ?? 'private');
        if (!in_array($mode, ['private', 'group'], true)) fail('Invalid call mode.', 422);

        $participantIds = $body['participant_ids'] ?? [];
        if (!is_array($participantIds)) $participantIds = [];
        $participantIds = array_values(array_unique(array_filter(array_map('strval', $participantIds))));
        if (count($participantIds) === 0) fail('Select at least one employee.', 422);
        if ($mode === 'private' && count($participantIds) !== 1) fail('Private calls need exactly one employee.', 422);
        if (($currentUser['role'] ?? '') === 'employee') {
            $participantIds = array_values(array_filter($participantIds, fn($id) => $id !== currentUserId($currentUser)));
            if (count($participantIds) === 0) fail('Select another employee to call.', 422);
            if ($mode !== 'private') fail('Employees can start private calls only.', 403);
        }

        $participantNames = [];
        foreach ($participantIds as $empId) {
            $emp = findOne(collection('employees'), ['_id' => mongoId($empId), 'status' => 'active']);
            if (!$emp) fail('Selected employee not found or inactive.', 404);
            $participantNames[] = (string)($emp['name'] ?? 'Employee');
        }

        if ($mode === 'private' && ($currentUser['role'] ?? '') === 'employee') {
            $ids = [currentUserId($currentUser), $participantIds[0]];
            sort($ids, SORT_STRING);
            $conversationId = 'employee-employee-' . $ids[0] . '-' . $ids[1];
        } else {
            $conversationId = $mode === 'private' ? 'hr-employee-' . $participantIds[0] : 'hr-group-' . callRoomId();
        }
        $roomId = callRoomId();
        $title = $mode === 'private'
            ? 'Call with ' . ($participantNames[0] ?? 'Employee')
            : 'Group HR call';

        $roomDoc = [
            'room_id' => $roomId,
            'mode' => $mode,
            'title' => $title,
            'host_id' => currentUserId($currentUser),
            'host_name' => (string)($currentUser['name'] ?? 'HR'),
            'conversation_id' => $conversationId,
            'participant_ids' => $participantIds,
            'participant_names' => $participantNames,
            'created_at' => new MongoDB\BSON\UTCDateTime(),
        ];
        $savedRoom = insertOne($rooms, $roomDoc);

        foreach ($participantIds as $index => $empId) {
            try {
                insertOne(collection('notifications'), [
                    'user_id' => $empId,
                    'role' => 'employee',
                    'title' => 'Team Call Invitation',
                    'message' => "room_id={$roomId};conversation_id={$conversationId};mode={$mode};host=" . ($currentUser['name'] ?? 'User') . "; " . ($currentUser['name'] ?? 'User') . " invited you to join " . ($mode === 'private' ? 'a private call.' : 'a group call.'),
                    'type' => 'info',
                    'is_read' => false,
                    'is_cleared' => false,
                    'created_at' => new MongoDB\BSON\UTCDateTime(),
                ]);
            } catch (Exception) {}
        }

        ok(['room' => normaliseCallRoom($savedRoom)], 'Call invitation sent.', 201);
    }

    if ($action === 'call' && $method === 'GET') {
        $conversationId = trim($_GET['conversation_id'] ?? '');
        $roomId = trim($_GET['room_id'] ?? '');
        if ($roomId !== '') ensureCallRoomAccess($currentUser, $roomId);
        else ensureConversationAccess($currentUser, $conversationId);

        $filter = $roomId !== '' ? ['room_id' => $roomId] : ['conversation_id' => $conversationId];
        $status = findOne($calls, $filter);
        ok(['call' => normaliseCallStatus($status)]);
    }

    if ($action === 'call' && $method === 'POST') {
        $body = chatBody();
        $conversationId = trim((string)($body['conversation_id'] ?? ''));
        $roomId = trim((string)($body['room_id'] ?? ''));
        if ($roomId !== '') {
            $room = ensureCallRoomAccess($currentUser, $roomId);
            $conversationId = (string)($room['conversation_id'] ?? $conversationId);
        } else {
            ensureConversationAccess($currentUser, $conversationId);
        }

        $status = trim((string)($body['status'] ?? 'idle'));
        $allowed = ['joined', 'left', 'screen_started', 'screen_stopped', 'muted', 'unmuted', 'camera_off', 'camera_on'];
        if (!in_array($status, $allowed, true)) fail('Invalid call status.', 422);

        $doc = [
            'conversation_id' => $conversationId,
            'room_id' => $roomId,
            'status' => $status,
            'user' => (string)($currentUser['name'] ?? 'User'),
            'user_id' => currentUserId($currentUser),
            'updated_at' => new MongoDB\BSON\UTCDateTime(),
        ];

        $filter = $roomId !== '' ? ['room_id' => $roomId] : ['conversation_id' => $conversationId];
        $existing = findOne($calls, $filter);
        if ($existing) {
            updateOne($calls, $filter, $doc);
            $saved = findOne($calls, $filter);
        } else {
            $saved = insertOne($calls, $doc);
        }

        ok(['call' => normaliseCallStatus($saved)]);
    }

    if ($action === 'join' && $method === 'POST') {
        $body = chatBody();
        $roomId = trim((string)($body['room_id'] ?? ''));
        if ($roomId === '') fail('Call room is required.', 422);
        ensureCallRoomAccess($currentUser, $roomId);

        $doc = [
            'room_id' => $roomId,
            'user_id' => currentUserId($currentUser),
            'name' => (string)($currentUser['name'] ?? 'User'),
            'role' => (string)($currentUser['role'] ?? ''),
            'active' => true,
            'updated_at' => new MongoDB\BSON\UTCDateTime(),
        ];

        $filter = ['room_id' => $roomId, 'user_id' => currentUserId($currentUser)];
        $existing = findOne($presence, $filter);
        if ($existing) updateOne($presence, $filter, $doc);
        else insertOne($presence, $doc);

        ok(['peer' => normalisePresence($doc)]);
    }

    if ($action === 'leave' && $method === 'POST') {
        $body = chatBody();
        $roomId = trim((string)($body['room_id'] ?? ''));
        if ($roomId !== '') {
            ensureCallRoomAccess($currentUser, $roomId);
            updateOne($presence, ['room_id' => $roomId, 'user_id' => currentUserId($currentUser)], [
                'active' => false,
                'updated_at' => new MongoDB\BSON\UTCDateTime(),
            ]);
        }
        ok(null, 'Left call.');
    }

    if ($action === 'peers' && $method === 'GET') {
        $roomId = trim($_GET['room_id'] ?? '');
        if ($roomId === '') fail('Call room is required.', 422);
        ensureCallRoomAccess($currentUser, $roomId);

        $docs = findMany($presence, ['room_id' => $roomId, 'active' => true], [
            'sort' => ['updated_at' => -1],
            'limit' => 20,
        ]);
        ok(['peers' => array_map('normalisePresence', $docs)]);
    }

    if ($action === 'signal' && $method === 'POST') {
        $body = chatBody();
        $roomId = trim((string)($body['room_id'] ?? ''));
        $toUserId = trim((string)($body['to_user_id'] ?? ''));
        $type = trim((string)($body['type'] ?? ''));
        $payload = $body['payload'] ?? null;
        if ($roomId === '' || $toUserId === '' || $type === '') fail('Signal data is incomplete.', 422);
        ensureCallRoomAccess($currentUser, $roomId);
        if (!in_array($type, ['offer', 'answer', 'ice'], true)) fail('Invalid signal type.', 422);

        $saved = insertOne($signals, [
            'room_id' => $roomId,
            'from_user_id' => currentUserId($currentUser),
            'from_name' => (string)($currentUser['name'] ?? 'User'),
            'to_user_id' => $toUserId,
            'type' => $type,
            'payload' => $payload,
            'created_at' => new MongoDB\BSON\UTCDateTime(),
        ]);
        ok(['signal' => normaliseSignal($saved)], 'Signal sent.', 201);
    }

    if ($action === 'signals' && $method === 'GET') {
        $roomId = trim($_GET['room_id'] ?? '');
        if ($roomId === '') fail('Call room is required.', 422);
        ensureCallRoomAccess($currentUser, $roomId);

        $docs = findMany($signals, [
            'room_id' => $roomId,
            'to_user_id' => currentUserId($currentUser),
        ], [
            'sort' => ['created_at' => 1],
            'limit' => 100,
        ]);
        ok(['signals' => array_map('normaliseSignal', $docs)]);
    }

    if ($action === 'team_rooms' && $method === 'GET') {
        syncDepartmentChatRooms();
        $role = trim(strtolower((string)($currentUser['role'] ?? '')));
        $designation = trim(strtolower((string)($currentUser['designation'] ?? '')));
        
        if ($role === 'hr' || $role === 'ceo' || $designation === 'ceo') {
            $docs = findMany(collection('chat_rooms'), [], ['sort' => ['department' => 1]]);
        } else {
            $userDept = trim((string)($currentUser['department'] ?? ''));
            $docs = findMany(collection('chat_rooms'), [
                'department' => ['$regex' => '^' . preg_quote($userDept, '/') . '$', '$options' => 'i']
            ], ['sort' => ['department' => 1]]);
        }

        $userId = currentUserId($currentUser);
        $roomsList = [];
        
        foreach ($docs as $doc) {
            $roomIdStr = (string)$doc['_id'];
            $roomDept = (string)($doc['department'] ?? '');
            
            // Get user's read state
            $readState = findOne(collection('chat_room_reads'), [
                'user_id' => $userId,
                'room_id' => $roomIdStr
            ]);
            
            $lastReadAt = $readState['last_read_at'] ?? new MongoDB\BSON\UTCDateTime(0);
            
            // Unread messages count
            $unreadCount = countDocs(collection('chat_messages'), [
                'room_id' => $roomIdStr,
                'sender_id' => ['$ne' => $userId],
                'created_at' => ['$gt' => $lastReadAt]
            ]);

            // Latest message preview
            $latestMsg = findOne(collection('chat_messages'), ['room_id' => $roomIdStr], [
                'sort' => ['created_at' => -1]
            ]);
            
            $preview = '';
            if ($latestMsg) {
                // Find sender name
                $senderId = $latestMsg['sender_id'];
                $sender = findOne(collection('employees'), ['_id' => mongoId($senderId)]);
                if (!$sender) {
                    $sender = findOne(collection('users'), ['_id' => mongoId($senderId)]);
                }
                $senderName = $sender['name'] ?? 'User';
                $preview = $senderName . ': ' . $latestMsg['message'];
            }

            $roomsList[] = [
                'id' => $roomIdStr,
                'name' => (string)($doc['name'] ?? teamRoomName($roomDept)),
                'department' => $roomDept,
                'member_count' => countDocs(collection('employees'), [
                    'department' => ['$regex' => '^' . preg_quote($roomDept, '/') . '$', '$options' => 'i'],
                    'status' => 'active'
                ]),
                'type' => (string)($doc['type'] ?? 'department'),
                'hr_included' => (bool)($doc['hr_included'] ?? true),
                'unread_count' => $unreadCount,
                'latest_message_preview' => $preview,
                'created_at' => (string)($doc['created_at'] ?? '')
            ];
        }

        ok(['rooms' => $roomsList]);
    }

    if ($action === 'team_messages' && $method === 'GET') {
        $roomId = trim($_GET['room_id'] ?? '');
        ensureTeamRoomAccess($currentUser, $roomId);

        // Update read state for the current user and room
        upsertOne(collection('chat_room_reads'), [
            'user_id' => currentUserId($currentUser),
            'room_id' => $roomId
        ], [
            'last_read_at' => new MongoDB\BSON\UTCDateTime()
        ]);

        $limit = min(30, max(10, (int)($_GET['limit'] ?? 30)));
        $filter = ['room_id' => $roomId];

        // Cursor-based pagination: load messages older than given ID
        $before = trim($_GET['before'] ?? '');
        if ($before !== '') {
            try {
                $filter['_id'] = ['$lt' => mongoId($before)];
            } catch (Exception) {}
        }

        $docs = findMany(collection('chat_messages'), $filter, [
            'sort'  => ['created_at' => -1],
            'limit' => $limit
        ]);

        $senderIds = array_unique(array_column($docs, 'sender_id'));
        $senderMap = [];
        $validSenderIds = array_values(array_filter($senderIds, fn($id) => preg_match('/^[a-f\d]{24}$/i', (string)$id)));
        
        if ($validSenderIds) {
            $emps = findMany(collection('employees'), ['_id' => ['$in' => array_map(fn($id) => mongoId($id), $validSenderIds)]]);
            foreach ($emps as $e) {
                $senderMap[(string)$e['_id']] = [
                    'name' => $e['name'] ?? 'User',
                    'profile_image' => $e['profile_image'] ?? null
                ];
            }
            $hrs = findMany(collection('users'), ['_id' => ['$in' => array_map(fn($id) => mongoId($id), $validSenderIds)]]);
            foreach ($hrs as $h) {
                $senderMap[(string)$h['_id']] = [
                    'name' => $h['name'] ?? 'HR Admin',
                    'profile_image' => $h['profile_image'] ?? null
                ];
            }
        }

        $data = [];
        foreach ($docs as $doc) {
            $sender = $senderMap[(string)$doc['sender_id']] ?? ['name' => 'Unknown', 'profile_image' => null];
            $created = $doc['created_at'] ?? null;
            if ($created instanceof MongoDB\BSON\UTCDateTime) {
                $created = $created->toDateTime()
                    ->setTimezone(new DateTimeZone('Asia/Kolkata'))
                    ->format(DateTimeInterface::ATOM);
            }
            $data[] = [
                'id' => (string)$doc['_id'],
                'room_id' => (string)$doc['room_id'],
                'sender_id' => (string)$doc['sender_id'],
                'sender_name' => $sender['name'],
                'sender_profile_image' => $sender['profile_image'],
                'message' => (string)$doc['message'],
                'created_at' => $created ?: '',
            ];
        }

        ok(['messages' => array_reverse($data), 'has_more' => count($data) === $limit]);
    }


    if ($action === 'team_send_message' && $method === 'POST') {
        $body = chatBody();
        $roomId = trim((string)($body['room_id'] ?? ''));
        ensureTeamRoomAccess($currentUser, $roomId);

        $messageText = trim((string)($body['message'] ?? ''));
        if ($messageText === '') fail('Message is required.', 422);
        if (strlen($messageText) > 1000) fail('Message is too long.', 422);

        // Sanitize to prevent XSS
        $sanitizedMessage = htmlspecialchars($messageText, ENT_QUOTES, 'UTF-8');

        $doc = [
            'room_id' => $roomId,
            'sender_id' => currentUserId($currentUser),
            'message' => $sanitizedMessage,
            'created_at' => new MongoDB\BSON\UTCDateTime(),
            'updated_at' => date('Y-m-d H:i:s'),
            'deleted_at' => null
        ];

        $saved = insertOne(collection('chat_messages'), $doc);

        upsertOne(collection('chat_room_reads'), [
            'user_id' => currentUserId($currentUser),
            'room_id' => $roomId
        ], [
            'last_read_at' => new MongoDB\BSON\UTCDateTime()
        ]);

        $sender = [
            'name' => $currentUser['name'] ?? 'User',
            'profile_image' => $currentUser['profile_image'] ?? null
        ];

        $created = $saved['created_at'] ?? null;
        if ($created instanceof MongoDB\BSON\UTCDateTime) {
            $created = $created->toDateTime()
                ->setTimezone(new DateTimeZone('Asia/Kolkata'))
                ->format(DateTimeInterface::ATOM);
        }

        ok([
            'id' => (string)$saved['_id'],
            'room_id' => (string)$saved['room_id'],
            'sender_id' => (string)$saved['sender_id'],
            'sender_name' => $sender['name'],
            'sender_profile_image' => $sender['profile_image'],
            'message' => (string)$saved['message'],
            'created_at' => $created ?: '',
        ], 'Message sent.', 201);
    }

    fail('Method not allowed.', 405);
} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}
