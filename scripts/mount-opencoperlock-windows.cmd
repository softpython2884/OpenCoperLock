@echo off
REM ===========================================================================
REM  OpenCoperLock - one-click WebDAV mount for Windows.
REM  Double-click this file. It runs the PowerShell script next to it, which
REM  configures Windows' WebClient service (a UAC prompt will appear) and maps
REM  your Drive to a drive letter.
REM
REM  Edit the three values below to taste, then double-click. You'll be asked to
REM  paste your API token (Account -> API tokens; use an unrestricted one).
REM ===========================================================================

set "SERVER=copper.forgenet.fr"
set "DRIVE=X"
set "LABEL=OpenCoperLock"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mount-opencoperlock-windows.ps1" -Server "%SERVER%" -Drive "%DRIVE%" -Label "%LABEL%"

echo.
pause
