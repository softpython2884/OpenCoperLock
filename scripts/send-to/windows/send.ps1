<#
  OpenCoperLock - "Send to" uploader (Windows).

  Invoked (via launch.vbs, hidden) with one or more file paths as arguments. Uploads each selected
  file to the "ComputerShared" space (a top-level folder in your Drive) over WebDAV, shows a small
  tray notification, and writes a detailed send.log so any problem can be diagnosed. Configuration
  (WebDAV URL + DPAPI-encrypted token + options) lives in %LOCALAPPDATA%\OpenCoperLock\config.json.
#>
$dir     = Join-Path $env:LOCALAPPDATA 'OpenCoperLock'
$cfgPath = Join-Path $dir 'config.json'
$icon    = Join-Path $dir 'opencoperlock.ico'
$logPath = Join-Path $dir 'send.log'

# Bulletproof logging via .NET so we always get a trace, even if something fails very early.
function Log($msg) {
  try {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::AppendAllText($logPath, ("{0}  {1}`r`n" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg))
  } catch { }
}
# Any uncaught error is logged instead of vanishing with the hidden window.
trap { Log "FATAL: $($_.Exception.Message)"; exit 1 }

Log "=== send.ps1 start; args=$($args.Count): $($args -join ' | ')"

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

if (-not (Test-Path $cfgPath)) { Log 'no config.json - run the installer'; Show-Toast 'OpenCoperLock' 'Not configured yet - run the installer.'; exit 1 }

$cfg  = Get-Content $cfgPath -Raw | ConvertFrom-Json
$base = ($cfg.base).TrimEnd('/')
$script:notify = -not ($cfg.PSObject.Properties.Name -contains 'notify' -and $cfg.notify -eq $false)
Log "config loaded; base=$base notify=$script:notify"

# Decrypt the DPAPI-protected token.
try {
  $sec  = ConvertTo-SecureString $cfg.token   # DPAPI, current user
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $tok  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
} catch { Log "token decrypt failed: $($_.Exception.Message)"; Show-Toast 'OpenCoperLock' 'Token unreadable - re-run the installer.'; exit 1 }
Log "token decrypted; length=$($tok.Length)"

$curl = "$env:SystemRoot\System32\curl.exe"
if (-not (Test-Path $curl)) { $curl = 'curl.exe' }  # fall back to PATH

$files = @($args | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) })
Log "files to send: $($files.Count)"
if ($files.Count -eq 0) { Show-Toast 'OpenCoperLock' 'No files to send (folders are skipped).'; exit 0 }

$cred = "me:$tok"
# Make sure the space exists (a 405 "already there" is fine and ignored).
$mk = & $curl -s -o NUL -w "%{http_code}" -u $cred -X MKCOL "$base/ComputerShared/" 2>&1
Log "MKCOL ComputerShared -> $mk (curl exit $LASTEXITCODE)"

$ok = 0; $fail = 0
foreach ($f in $files) {
  $leaf = Split-Path -LiteralPath $f -Leaf
  $name = [uri]::EscapeDataString($leaf)
  $code = & $curl -s -o NUL -w "%{http_code}" -u $cred -T $f "$base/ComputerShared/$name" 2>&1
  Log "PUT '$leaf' -> $base/ComputerShared/$name = $code (curl exit $LASTEXITCODE)"
  if ("$code" -match '^2\d\d') { $ok++ } else { $fail++ }
}
$tok = $null; $cred = $null

Log "=== done: ok=$ok fail=$fail"
if ($fail -eq 0) { Show-Toast 'OpenCoperLock' "Sent $ok file(s) to ComputerShared." }
else { Show-Toast 'OpenCoperLock' "Sent $ok, $fail failed - see send.log." }
