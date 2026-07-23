<#
  OpenCoperLock — "Send to" uploader (Windows).

  Invoked (via launch.vbs, hidden) with one or more file paths as arguments. Uploads each selected
  file to the "ComputerShared" space (a top-level folder in your Drive) over WebDAV, shows a small
  tray notification, and appends a line to send.log so problems can be diagnosed. Configuration
  (WebDAV URL + DPAPI-encrypted token + options) lives in %LOCALAPPDATA%\OpenCoperLock\config.json.
#>
$ErrorActionPreference = 'Stop'
$dir     = Join-Path $env:LOCALAPPDATA 'OpenCoperLock'
$cfgPath = Join-Path $dir 'config.json'
$icon    = Join-Path $dir 'opencoperlock.ico'
$logPath = Join-Path $dir 'send.log'

function Log($msg) {
  try { Add-Content -LiteralPath $logPath -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) } catch { }
}

function Show-Toast($title, $text) {
  if ($script:notify -eq $false) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $ni = New-Object System.Windows.Forms.NotifyIcon
    $ni.Icon = if (Test-Path $icon) { New-Object System.Drawing.Icon($icon) } else { [System.Drawing.SystemIcons]::Information }
    $ni.Visible = $true
    $ni.ShowBalloonTip(4000, $title, $text, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Milliseconds 4200
    $ni.Dispose()
  } catch { Log "toast failed: $($_.Exception.Message)" }
}

Log "invoked with $($args.Count) arg(s): $($args -join ' | ')"

if (-not (Test-Path $cfgPath)) { Log 'no config'; Show-Toast 'OpenCoperLock' 'Not configured yet — run the installer.'; exit 1 }

$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$base = ($cfg.base).TrimEnd('/')
$script:notify = -not ($cfg.PSObject.Properties.Name -contains 'notify' -and $cfg.notify -eq $false)

# Decrypt the DPAPI-protected token.
$sec  = ConvertTo-SecureString $cfg.token
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$tok  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$files = @($args | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($files.Count -eq 0) { Log 'no files after filter'; Show-Toast 'OpenCoperLock' 'No files to send (folders are skipped).'; exit 0 }

$cred = "me:$tok"
# Make sure the space exists (a 405 "already there" is fine and ignored).
& curl.exe -s -u $cred -X MKCOL "$base/ComputerShared/" | Out-Null

$ok = 0; $fail = 0
foreach ($f in $files) {
  $name = [uri]::EscapeDataString((Split-Path -LiteralPath $f -Leaf))
  $code = & curl.exe -s -o NUL -w "%{http_code}" -u $cred -T $f "$base/ComputerShared/$name"
  Log "PUT $f -> $base/ComputerShared/$name = $code"
  if ($code -match '^2') { $ok++ } else { $fail++ }
}
$tok = $null; $cred = $null

Log "done: ok=$ok fail=$fail"
if ($fail -eq 0) { Show-Toast 'OpenCoperLock' "Sent $ok file(s) to ComputerShared." }
else { Show-Toast 'OpenCoperLock' "Sent $ok, $fail failed — see send.log." }
