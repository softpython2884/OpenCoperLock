@echo off
REM ===========================================================================
REM  OpenCoperLock - Windows right-click menu manager (GUI).
REM  Double-click to open a small window that lists every right-click entry and
REM  lets you tick/untick each one. The script asks for Administrator itself
REM  (UAC prompt) so it can manage system-wide entries. Nothing is deleted -
REM  toggles are reversible.
REM ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-context-menu-manager.ps1"
