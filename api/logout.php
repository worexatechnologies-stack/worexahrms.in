<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
clear_auth_cookie();
ok(null, 'Logged out.');
