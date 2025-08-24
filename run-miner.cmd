@echo off
setlocal
REM KBUC Miner installer & runner wrapper
REM Pass all arguments to the PowerShell script
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-and-run.ps1" %*
exit /b %ERRORLEVEL%
