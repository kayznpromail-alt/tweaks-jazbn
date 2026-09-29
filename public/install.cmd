@echo off
setlocal
title edgeyCLI installer
echo.
echo   edgeyCLI installer
echo   Paste the CLI key you received with your purchase when asked.
echo.
rem Runs the upstream CLI installer, then adds the "edgey" command.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $s=Join-Path $env:TEMP ('edgey-setup-'+[guid]::NewGuid().ToString('N')+'.ps1'); try { Invoke-WebRequest -UseBasicParsing -MaximumRedirection 0 -Uri 'https://dawvq.com/install.ps1' -OutFile $s; & $s } finally { if (Test-Path -LiteralPath $s) { Remove-Item -LiteralPath $s -Force } }"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $b=Join-Path $env:USERPROFILE '.edgey\bin'; New-Item -ItemType Directory -Force -Path $b | Out-Null; $exe=Join-Path $env:USERPROFILE '.dawvq\bin\dawvq.exe'; $q=[char]34; Set-Content -LiteralPath (Join-Path $b 'edgey.cmd') -Value '@echo off',($q+$exe+$q+' %%*') -Encoding ASCII; $p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not $p) { $p='' }; if (($p -split ';') -notcontains $b) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';')+';'+$b).TrimStart(';'), 'User') }"
if errorlevel 1 exit /b 1
echo.
echo   edgeyCLI is installed.
echo   Open a NEW terminal in your project folder and run: edgey
echo.
