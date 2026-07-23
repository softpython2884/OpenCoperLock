@echo off
REM ===========================================================================
REM  OpenCoperLock - quick declutter for the Windows 11 right-click menu.
REM  Disables the noisy app entries (Edit with Photos, Create with Designer,
REM  Edit with Paint, Ask Copilot). Asks for Administrator, lists what it found,
REM  and confirms before changing anything. Fully reversible.
REM ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-declutter.ps1"
echo.
pause
