' OpenCoperLock — windowless launcher.
'
' Invoked by the "Send to", "Drop on OpenCoperLock" and "Multi-Drop on OpenCoperLock" entries with
' the selected file path(s) as arguments. It forwards them to send.ps1 and runs PowerShell HIDDEN
' (window style 0) so no console flashes. VBScript via wscript.exe is the reliable way to receive
' the selected files AND stay windowless.
Option Explicit
Dim sh, dst, cmd, i
Set sh = CreateObject("WScript.Shell")
dst = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\OpenCoperLock"

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dst & "\send.ps1"""
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next

' 0 = hidden window, False = don't wait (return immediately so Explorer isn't blocked).
sh.Run cmd, 0, False
