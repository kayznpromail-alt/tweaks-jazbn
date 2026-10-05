$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot 'edgey.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'edgey.exe is missing; build or extract the complete Windows package first' }
$targetRoot = Join-Path $env:USERPROFILE '.edgey'
$targetBin = Join-Path $targetRoot 'bin'
foreach ($entry in @($targetRoot, $targetBin)) {
  if (Test-Path -LiteralPath $entry) {
    $item = Get-Item -LiteralPath $entry -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'installation directory must be a regular directory' }
  } else { $null = New-Item -ItemType Directory -Path $entry }
}
Copy-Item -LiteralPath $executable -Destination (Join-Path $targetBin 'edgey.exe')
foreach ($notice in @('THIRD_PARTY_NOTICES.txt','BUN_RUNTIME_NOTICES.txt')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $notice) -Destination (Join-Path $targetRoot $notice)
}
$userPath = [Environment]::GetEnvironmentVariable('Path','User')
if (($userPath -split ';') -notcontains $targetBin) {
  [Environment]::SetEnvironmentVariable('Path', ($targetBin + ';' + $userPath), 'User')
}
Write-Host 'edgey installed. Open a new terminal and run edgey.'
