@echo off
setlocal
title edgeyCLI installer
echo.
echo   edgeyCLI installer
echo   Paste the CLI key you received with your purchase when asked.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; $s=Join-Path $env:TEMP ('edgey-setup-'+[guid]::NewGuid().ToString('N')+'.ps1'); try { Invoke-WebRequest -UseBasicParsing -MaximumRedirection 0 -Uri 'https://cli.edgey.shop/setup.ps1' -OutFile $s; & $s; exit $LASTEXITCODE } catch { Write-Host '  Installation failed. Need help? https://discord.gg/edgey' -ForegroundColor Red; exit 1 } finally { if (Test-Path -LiteralPath $s) { Remove-Item -LiteralPath $s -Force } }"
if errorlevel 1 exit /b 1
