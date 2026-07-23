' OpenCoperLock - windowless launcher.
'
' Invoked by the "Send to", "Drop on OpenCoperLock" and "Multi-Drop on OpenCoperLock" entries with
' the selected file path(s) as arguments. It forwards them to send.ps1 and runs PowerShell HIDDEN
' (window style 0) so no console flashes. It also writes launch.log so we can tell whether the menu
' entry actually fired (if launch.log grows but send.log does not, PowerShell/send.ps1 is the issue).
Option Explicit
Dim sh, fso, dst, cmd, i, logPath, log
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dst = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\OpenCoperLock"

logPath = dst & "\launch.log"
On Error Resume Next
Set log = fso.OpenTextFile(logPath, 8, True)   ' 8 = append, True = create if missing
log.WriteLine Now & "  launch.vbs fired, args=" & WScript.Arguments.Count
On Error GoTo 0

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dst & "\send.ps1"""
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
  On Error Resume Next
  If Not (log Is Nothing) Then log.WriteLine "  arg: " & WScript.Arguments(i)
  On Error GoTo 0
Next

On Error Resume Next
If Not (log Is Nothing) Then
  log.WriteLine "  run: " & cmd
  log.Close
End If
On Error GoTo 0

sh.Run cmd, 0, False
