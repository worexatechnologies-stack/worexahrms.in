$url = "https://windows.php.net/downloads/pecl/releases/mongodb/1.18.0/php_mongodb-1.18.0-8.3-ts-vs16-x64.zip"
$zipPath = "mongodb.zip"
$extractPath = "mongodb_ext"
$phpDir = "C:\worexacompany projects backup\Worexa projects final ready zip backup\finaladvocates\finaladvocates\php"

Write-Host "Downloading MongoDB extension..."
Invoke-WebRequest -Uri $url -OutFile $zipPath

Write-Host "Extracting..."
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

Write-Host "Copying DLL..."
Copy-Item "$extractPath\php_mongodb.dll" -Destination "$phpDir\ext\" -Force

Write-Host "Setting up php.ini..."
if (-not (Test-Path "$phpDir\php.ini")) {
    Copy-Item "$phpDir\php.ini-development" "$phpDir\php.ini"
}

$iniContent = Get-Content "$phpDir\php.ini"
if ($iniContent -notmatch "extension=mongodb") {
    Add-Content -Path "$phpDir\php.ini" -Value "`nextension_dir = `"ext`"`n"
    Add-Content -Path "$phpDir\php.ini" -Value "extension=mongodb`n"
    Write-Host "Added extension=mongodb to php.ini"
} else {
    Write-Host "mongodb extension already in php.ini"
}

Write-Host "Done"
