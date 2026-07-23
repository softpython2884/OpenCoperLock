@echo off
REM ===========================================================================
REM  OpenCoperLock - Windows right-click menu manager (GUI, elevated).
REM  Double-click to open a small window that lists every right-click entry and
REM  lets you tick/untick each one. Requests Administrator so it can manage
REM  system-wide entries too. Nothing is deleted - toggles are reversible.
REM ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','\"%~dp0windows-context-menu-manager.ps1\"'"
