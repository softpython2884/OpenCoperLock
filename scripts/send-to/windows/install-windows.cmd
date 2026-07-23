@echo off
REM ===========================================================================
REM  OpenCoperLock - install "Send to > OpenCoperLock" (Windows, no admin).
REM  Double-click this file. You'll be asked for your WebDAV URL and API token,
REM  then an "OpenCoperLock" entry (with the logo) appears in the right-click
REM  "Send to" menu. Selected files upload to the "ComputerShared" space.
REM ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
echo.
pause
