$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$destination = Join-Path $projectRoot "releases/edgeyCLI-$version-windows.zip"
if (Test-Path -LiteralPath $destination) { throw 'Windows package already exists; choose a new version' }
$paths = @('edgey.exe','install.cmd','scripts/install-edgey.ps1','THIRD_PARTY_NOTICES.txt','BUN_RUNTIME_NOTICES.txt','vscode-extension/edgey-mcp-bridge-0.1.0.vsix')
foreach ($relative in $paths) {
  $item = Get-Item -LiteralPath (Join-Path $projectRoot $relative)
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'package inputs must be regular files' }
}
$null = New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'releases')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($destination, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in $paths) {
    $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $projectRoot $relative), $relative)
  }
} finally { $archive.Dispose() }
$stream = [IO.File]::OpenRead($destination)
$algorithm = [Security.Cryptography.SHA256]::Create()
try { $hash = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
finally { $stream.Dispose(); $algorithm.Dispose() }
[IO.File]::WriteAllText($destination + '.sha256', "$hash  $([IO.Path]::GetFileName($destination))`n")
Write-Host $destination
