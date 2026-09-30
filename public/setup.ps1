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

# Upstream package host, and the name its files use.
$src = [Text.Encoding]::ASCII.GetString([Convert]::FromBase64String('ZGF3dnEuY29t'))
$name = $src.Split('.')[0]

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
  $account = Invoke-RestMethod -Uri ('https://api.' + $src + '/v1/account') -Headers @{ Authorization = 'Bearer ' + $key } -TimeoutSec 20 -MaximumRedirection 0
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

# 2. Find the current release (URL, size and SHA-256 published by upstream).
try {
  $meta = (Invoke-WebRequest -UseBasicParsing -Uri ('https://' + $src + '/install.ps1') -TimeoutSec 30 -MaximumRedirection 0).Content
  if ($meta -is [byte[]]) { $meta = [Text.Encoding]::UTF8.GetString($meta) }
} catch { Fail 'The download is unavailable right now. Try again later.' }
$url = [regex]::Match($meta, '\$archiveUrl\s*=\s*''([^'']+)''').Groups[1].Value
$hash = [regex]::Match($meta, '\$expectedHash\s*=\s*''([0-9a-f]{64})''').Groups[1].Value
$size = [regex]::Match($meta, '\$expectedBytes\s*=\s*(\d+)').Groups[1].Value
if (-not $url -or -not $hash -or -not $size -or -not $url.StartsWith('https://' + $src + '/')) {
  Fail 'The download is unavailable right now. Try again later.'
}

# 3. Download, verify and install quietly.
$stage = Join-Path $env:TEMP ('edgey-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  Write-Host '  Downloading edgeyCLI (about 140 MB)...'
  $zip = Join-Path $stage 'package.zip'
  try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip -MaximumRedirection 0 }
  catch { Fail 'Download failed. Check your connection and try again.' }
  if ((Get-Item -LiteralPath $zip).Length -ne [long]$size) { Fail 'Download check failed. Nothing was changed.' }
  $digest = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($digest -ne $hash) { Fail 'Download check failed. Nothing was changed.' }

  Write-Host '  Installing...'
  $files = Join-Path $stage 'files'
  Expand-Archive -LiteralPath $zip -DestinationPath $files
  $inner = Join-Path $files 'install.ps1'
  if (-not (Test-Path -LiteralPath $inner)) { Fail 'Installation failed. Try again later.' }
  try { & $inner -Channel stable -NoPathUpdate *> $null }
  catch { Fail 'Installation failed. Close any open edgey windows and try again.' }
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}

$exe = Join-Path $env:USERPROFILE ('.' + $name + '\bin\' + $name + '.exe')
if (-not (Test-Path -LiteralPath $exe)) { Fail 'Installation failed. Try again later.' }

# 4. The "edgey" command.
$bin = Join-Path $env:USERPROFILE '.edgey\bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Set-Content -LiteralPath (Join-Path $bin 'edgey.cmd') -Value '@echo off', ('"' + $exe + '" %*') -Encoding ASCII
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
