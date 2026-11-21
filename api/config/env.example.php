<?php
declare(strict_types=1);

// Production environment variables fallback template
// Copy to env.php or configure via environment variables / .env
$productionEnv = [
    'MONGODB_URI' => 'mongodb+srv://<username>:<password>@<cluster>.mongodb.net',
    'MONGODB_DB_NAME' => 'hrms',
    'HRMS_JWT_SECRET' => 'your-secure-jwt-secret-here',
    'HRMS_ENV' => 'production',
    'APP_ENV' => 'production',
    'HRMS_ALLOWED_ORIGINS' => 'https://worexahrms.in,https://www.worexahrms.in,http://worexahrms.in,https://worexahrms.xyz,https://www.worexahrms.xyz,http://worexahrms.xyz',
    'VITE_API_MAX_CONCURRENT' => '1',
    'VITE_API_BUSY_RETRIES' => '2',
    'VITE_API_BASE_URL' => '/api',
];

foreach ($productionEnv as $name => $value) {
    if (empty(getenv($name)) && empty($_ENV[$name]) && empty($_SERVER[$name])) {
        putenv(sprintf('%s=%s', $name, $value));
        $_ENV[$name] = $value;
        $_SERVER[$name] = $value;
    }
}
