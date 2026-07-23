@echo off
REM ===========================================================================
REM  OpenCoperLock — Windows right-click menu manager (elevated).
REM  Double-click to tidy the Explorer right-click menu. Requests Administrator
REM  so it can also manage system-wide entries. Nothing is deleted — items are
REM  just disabled/enabled reversibly.
REM ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','\"%~dp0windows-context-menu-manager.ps1\"'"
