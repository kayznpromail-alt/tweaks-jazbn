# edgeyCLI installer for Windows. Started by install.cmd; works in Windows PowerShell 5.1 and PowerShell 7.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Fail([string]$message) {
  Write-Host ''
  Write-Host ('  ' + $message) -ForegroundColor Red
  Write-Host '  Need help? https://discord.gg/edgey'
  Write-Host ''
  exit 1
}

$api = 'https://api.edgey.shop'
$platform = 'win32-x64'

# 1. Check the CLI key before downloading anything.
$secret = Read-Host '  Enter your edgey CLI key (hidden)' -AsSecureString
if ($null -eq $secret -or $secret.Length -eq 0 -or $secret.Length -gt 4096) { Fail 'No key entered. Nothing was installed.' }
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secret.Dispose() }
if ($key -cnotmatch '^[\x21-\x7e]{1,4096}$') { Fail 'This does not look like a CLI key. Nothing was installed.' }

Write-Host '  Checking your key...'
$account = $null
try {
  $account = Invoke-RestMethod -Uri "$api/v1/account" -Headers @{ Authorization = 'Bearer ' + $key } -TimeoutSec 20 -MaximumRedirection 0
} catch {
  $code = 0
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  $key = $null
  if ($code -eq 401 -or $code -eq 403) { Fail 'This CLI key is invalid or revoked. Nothing was installed.' }
  if ($code -eq 429) { Fail 'Too many attempts. Try again in a few minutes.' }
  Fail 'Key check is unavailable right now. Try again later.'
}
$key = $null
if ($null -eq $account -or $null -eq $account.status) { Fail 'Key check is unavailable right now. Try again later.' }
if ($account.status -eq 'paused') { Fail 'This CLI key is paused. Contact us on Discord.' }
if ($account.status -eq 'expired') { Fail 'This CLI key has expired. Contact us on Discord.' }
if ($account.status -eq 'exhausted') { Write-Host '  Key OK. Your tokens are used up: top up on cli.edgey.shop to use models.' -ForegroundColor Yellow }
else { Write-Host '  Key OK.' -ForegroundColor Green }

# 2. Find the current release from the edgey API.
try {
  $manifest = Invoke-RestMethod -Uri "$api/v1/cli-release" -TimeoutSec 15 -MaximumRedirection 0
} catch { Fail 'The download is unavailable right now. Try again later.' }
if ($null -eq $manifest.release) { Fail 'No release available yet. Try again later.' }
$release = $manifest.release
$asset = $release.assets.$platform
if ($null -eq $asset -or -not $asset.url -or -not $asset.sha256 -or -not $asset.bytes) {
  Fail 'No release available for your platform. Try again later.'
}
$url = $asset.url
$hash = $asset.sha256
$size = [long]$asset.bytes

# 3. Download, verify and install.
$stage = Join-Path $env:TEMP ('edgey-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  Write-Host "  Downloading edgeyCLI $($release.version) (about $([math]::Round($size / 1MB)) MB)..."
  $exe = Join-Path $stage 'edgey.exe'
  try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $exe -MaximumRedirection 0 }
  catch { Fail 'Download failed. Check your connection and try again.' }
  if ((Get-Item -LiteralPath $exe).Length -ne $size) { Fail 'Download check failed. Nothing was changed.' }
  $digest = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($digest -ne $hash) { Fail 'Download check failed. Nothing was changed.' }

  # Install into ~/.edgey/versions/<version>.exe
  $root = Join-Path $env:USERPROFILE '.edgey'
  $versions = Join-Path $root 'versions'
  New-Item -ItemType Directory -Force -Path $versions | Out-Null
  $target = Join-Path $versions "$($release.version).exe"
  Copy-Item -LiteralPath $exe -Destination $target -Force

  # Write the current version pointer.
  $pointer = Join-Path $root 'current.json'
  Set-Content -LiteralPath $pointer -Value ('{"version":"' + $release.version + '","platform":"' + $platform + '","previous":null}') -Encoding UTF8
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $target)) { Fail 'Installation failed. Try again later.' }

# 4. The "edgey" command.
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Set-Content -LiteralPath (Join-Path $bin 'edgey.cmd') -Value '@echo off', ('"' + $target + '" %*') -Encoding ASCII
$path = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $path) { $path = '' }
if (($path -split ';') -notcontains $bin) {
  [Environment]::SetEnvironmentVariable('Path', ($path.TrimEnd(';') + ';' + $bin).TrimStart(';'), 'User')
}

Write-Host ''
Write-Host '  edgeyCLI is installed.' -ForegroundColor Green
Write-Host '  Open a NEW terminal in your project folder and run: edgey'
Write-Host ''
exit 0
