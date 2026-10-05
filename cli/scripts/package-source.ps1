$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$destination = Join-Path $projectRoot "releases/edgeyCLI-$version-source.zip"
if (Test-Path -LiteralPath $destination) { throw 'source package already exists; remove it explicitly or choose a new version' }
$null = New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'releases')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($destination, [IO.Compression.ZipArchiveMode]::Create)
try {
  $paths = @('src','bin','scripts','package.json','package-lock.json','tsconfig.json','THIRD_PARTY_NOTICES.txt','BUN_RUNTIME_NOTICES.txt','DEPENDENCIES.json','install.cmd','.gitignore','vscode-extension/src','vscode-extension/scripts','vscode-extension/package.json','vscode-extension/package-lock.json','vscode-extension/tsconfig.json','vscode-extension/THIRD_PARTY_NOTICES.txt')
  foreach ($relative in $paths) {
    $path = Join-Path $projectRoot $relative
    $item = Get-Item -LiteralPath $path -Force
    $files = if ($item.PSIsContainer) { Get-ChildItem -LiteralPath $path -Recurse -File -Force } else { @($item) }
    foreach ($file in $files) {
      if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'source links are not allowed' }
      $entry = $file.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
      if ($entry -match '(^|/)\.[^/]+/' -or $entry -match '\.(db|log)($|[-.])' -or $entry -match '(^|/)\.env($|\.)') { continue }
      if ($entry.EndsWith('.md', [StringComparison]::OrdinalIgnoreCase)) { throw 'markdown is not distributable' }
      $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entry)
    }
  }
} finally { $archive.Dispose() }
$stream = [IO.File]::OpenRead($destination)
$algorithm = [Security.Cryptography.SHA256]::Create()
try { $hash = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
finally { $stream.Dispose(); $algorithm.Dispose() }
[IO.File]::WriteAllText($destination + '.sha256', "$hash  $([IO.Path]::GetFileName($destination))`n")
Write-Host $destination
