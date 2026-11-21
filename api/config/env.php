<?php
declare(strict_types=1);

// Production environment variables fallback
$productionEnv = [
    'MONGODB_URI' => 'mongodb+srv://ullasgowdaworexa_db_user:CKNINKHTuKzoZbRM@cluster0.4ptj6i3.mongodb.net',
    'MONGODB_DB_NAME' => 'hrms',
    'HRMS_JWT_SECRET' => '8250ba4db2b0d277509adbfa1ff4ca5b3525ad3e3cdca32b72cd6daceb3a551ca3f418e0920816db559ef61280f1cd62',
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
