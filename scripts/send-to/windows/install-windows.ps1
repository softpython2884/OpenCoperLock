<#
  OpenCoperLock - install the right-click "send to OpenCoperLock" integration (Windows).

  Per-user, NO administrator rights needed. It:
    1. installs the uploader (send.ps1), a windowless launcher (launch.vbs) and the brand icon into
       %LOCALAPPDATA%\OpenCoperLock,
    2. asks for your WebDAV URL + API token (the token is DPAPI-encrypted for your Windows user -
       unreadable by others, never leaves your machine) and your preferences,
    3. pre-creates the "ComputerShared" space in your Drive,
    4. adds the integration points you chose:
         - Explorer's "Send to > OpenCoperLock" (uploads ALL selected files in one go), and/or
         - right-click "Drop on OpenCoperLock" / "Multi-Drop on OpenCoperLock" entries.

  Uploads land in the "ComputerShared" space. Everything runs hidden (no PowerShell window flash)
  and shows a small tray notification when done (can be turned off).

  Run:  right-click install-windows.cmd, or
        powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
#>
[CmdletBinding()]
param(
  [string]$Base,
  [string]$Token,
  [ValidateSet('yes', 'no')] [string]$Notify,
  [ValidateSet('yes', 'no')] [string]$ContextMenu,
  [ValidateSet('yes', 'no')] [string]$SendTo
)
$ErrorActionPreference = 'Stop'

# Components come from the local checkout when run from one, or from the official repo when this
# script is piped from the web (irm ... | iex), so a one-line install works either way.
$RepoRaw = 'https://raw.githubusercontent.com/softpython2884/OpenCoperLock/main/scripts/send-to'
$self = $PSCommandPath                                              # null under irm|iex
$sendToRoot = if ($self) { Split-Path -Parent (Split-Path -Parent $self) } else { $null }
$dstDir = Join-Path $env:LOCALAPPDATA 'OpenCoperLock'
New-Item -ItemType Directory -Force -Path $dstDir | Out-Null

function Get-Component($rel, $dst) {
  $local = if ($sendToRoot) { Join-Path $sendToRoot ($rel -replace '/', '\') } else { $null }
  if ($local -and (Test-Path $local)) { Copy-Item $local $dst -Force }
  else { Invoke-WebRequest -UseBasicParsing "$RepoRaw/$rel" -OutFile $dst }
}
function Ask-YesNo($prompt, $default) {
  $d = if ($default) { 'Y/n' } else { 'y/N' }
  $a = (Read-Host "$prompt [$d]").Trim().ToLower()
  if ($a -eq '') { return $default }
  return ($a -eq 'y' -or $a -eq 'yes' -or $a -eq 'o' -or $a -eq 'oui')
}

# --- gather settings -----------------------------------------------------------------------------
$defaultBase = 'https://copper.forgenet.fr/api/dav'
if (-not $Base) {
  $inp = Read-Host "WebDAV base URL [$defaultBase]"
  $Base = if ([string]::IsNullOrWhiteSpace($inp)) { $defaultBase } else { $inp.Trim() }
}
$Base = $Base.TrimEnd('/')

if (-not $Token) {
  $sec  = Read-Host "Paste your OpenCoperLock API token (ocl_...)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if ([string]::IsNullOrWhiteSpace($Token)) { throw "No token provided." }

$wantNotify  = if ($Notify)      { $Notify -eq 'yes' }      else { Ask-YesNo "Show a small notification after each send?" $true }
$wantSendTo  = if ($SendTo)      { $SendTo -eq 'yes' }      else { Ask-YesNo "Add 'OpenCoperLock' to the 'Send to' menu (best for many files at once)?" $true }
$wantContext = if ($ContextMenu) { $ContextMenu -eq 'yes' } else { Ask-YesNo "Add 'Drop / Multi-Drop on OpenCoperLock' to the right-click menu?" $true }

# --- install files -------------------------------------------------------------------------------
Get-Component 'windows/send.ps1'            (Join-Path $dstDir 'send.ps1')
Get-Component 'windows/launch.vbs'          (Join-Path $dstDir 'launch.vbs')
Get-Component 'assets/opencoperlock.ico'    (Join-Path $dstDir 'opencoperlock.ico')

# DPAPI-encrypt the token (current-user scope) and write the config.
$enc = ConvertTo-SecureString $Token -AsPlainText -Force | ConvertFrom-SecureString
[pscustomobject]@{ base = $Base; token = $enc; notify = $wantNotify } | ConvertTo-Json | Set-Content (Join-Path $dstDir 'config.json') -Encoding UTF8

# --- pre-create the ComputerShared space ---------------------------------------------------------
try { & curl.exe -s -u "me:$Token" -X MKCOL "$Base/ComputerShared/" | Out-Null } catch { }
$Token = $null

$vbs = Join-Path $dstDir 'launch.vbs'
$ico = Join-Path $dstDir 'opencoperlock.ico'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

# --- "Send to" shortcut (targets wscript+launch.vbs so files pass reliably and no window shows) ---
$sendToLnk = Join-Path ([Environment]::GetFolderPath('SendTo')) 'OpenCoperLock.lnk'
if ($wantSendTo) {
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($sendToLnk)
  $sc.TargetPath       = $wscript
  $sc.Arguments        = '"' + $vbs + '"'
  $sc.IconLocation     = "$ico,0"
  $sc.Description       = 'Send to OpenCoperLock (ComputerShared)'
  $sc.WorkingDirectory = $dstDir
  $sc.Save()
} elseif (Test-Path $sendToLnk) { Remove-Item $sendToLnk -Force }

# --- right-click context-menu verbs (per-user HKCU, applies to all files) -------------------------
# Use the .NET registry API: the all-files key is literally named "*", which the PowerShell registry
# provider would treat as a wildcard.
function Set-Verb($keyName, $label) {
  $k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\*\shell\$keyName")
  $k.SetValue('MUIVerb', $label)
  $k.SetValue('Icon', $ico)
  $c = $k.CreateSubKey('command')
  $c.SetValue('', '"' + $wscript + '" "' + $vbs + '" "%1"')   # '' = the key's (default) value
  $c.Close(); $k.Close()
}
if ($wantContext) {
  Set-Verb 'OpenCoperLock.Drop'      'Drop on OpenCoperLock'
  Set-Verb 'OpenCoperLock.MultiDrop' 'Multi-Drop on OpenCoperLock'
} else {
  foreach ($k in 'OpenCoperLock.Drop', 'OpenCoperLock.MultiDrop') {
    try { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("Software\Classes\*\shell\$k", $false) } catch { }
  }
}

Write-Host ""
Write-Host "Installed." -ForegroundColor Green
if ($wantSendTo)  { Write-Host "  - Right-click file(s) -> Send to -> OpenCoperLock (uploads all selected at once)." -ForegroundColor DarkGray }
if ($wantContext) { Write-Host "  - Right-click file(s) -> Drop / Multi-Drop on OpenCoperLock." -ForegroundColor DarkGray }
Write-Host "  Uploads land in the 'ComputerShared' space. Log: $dstDir\send.log" -ForegroundColor DarkGray
Write-Host "  Re-run this installer any time to change settings." -ForegroundColor DarkGray
