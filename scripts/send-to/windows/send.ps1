<#
  OpenCoperLock — "Send to" uploader (Windows).

  Invoked by the "Send to > OpenCoperLock" shortcut with one or more file paths as arguments.
  Uploads each selected file to the "ComputerShared" space (a top-level folder in your Drive) over
  WebDAV, then shows a tray notification. Configuration (WebDAV URL + API token) is written by
  install-windows.cmd into %LOCALAPPDATA%\OpenCoperLock; the token is DPAPI-encrypted for your
  Windows user, so this file holds no secret.
#>
$ErrorActionPreference = 'Stop'
$dir     = Join-Path $env:LOCALAPPDATA 'OpenCoperLock'
$cfgPath = Join-Path $dir 'config.json'
$icon    = Join-Path $dir 'opencoperlock.ico'

function Show-Toast($title, $text) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $ni = New-Object System.Windows.Forms.NotifyIcon
    $ni.Icon = if (Test-Path $icon) { New-Object System.Drawing.Icon($icon) } else { [System.Drawing.SystemIcons]::Information }
    $ni.Visible = $true
    $ni.ShowBalloonTip(4000, $title, $text, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Milliseconds 4200
    $ni.Dispose()
  } catch { }
}

if (-not (Test-Path $cfgPath)) { Show-Toast 'OpenCoperLock' 'Not configured yet — run the installer.'; exit 1 }

$cfg  = Get-Content $cfgPath -Raw | ConvertFrom-Json
$base = ($cfg.base).TrimEnd('/')

# Decrypt the DPAPI-protected token.
$sec  = ConvertTo-SecureString $cfg.token
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$tok  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$files = @($args | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($files.Count -eq 0) { Show-Toast 'OpenCoperLock' 'No files to send (folders are skipped).'; exit 0 }

$cred = "me:$tok"
# Make sure the space exists (a 405 "already there" is fine and ignored).
& curl.exe -s -u $cred -X MKCOL "$base/ComputerShared/" | Out-Null

$ok = 0; $fail = 0
foreach ($f in $files) {
  $name = [uri]::EscapeDataString((Split-Path -LiteralPath $f -Leaf))
  $code = & curl.exe -s -o NUL -w "%{http_code}" -u $cred -T $f "$base/ComputerShared/$name"
  if ($code -match '^2') { $ok++ } else { $fail++ }
}
$tok = $null; $cred = $null

if ($fail -eq 0) { Show-Toast 'OpenCoperLock' "Sent $ok file(s) to ComputerShared." }
else { Show-Toast 'OpenCoperLock' "Sent $ok, $fail failed — check your token or connection." }
