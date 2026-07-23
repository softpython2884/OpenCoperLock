<#
  OpenCoperLock — install the "Send to > OpenCoperLock" integration (Windows).

  Per-user, NO administrator rights needed. It:
    1. copies the uploader (send.ps1) and the brand icon into %LOCALAPPDATA%\OpenCoperLock,
    2. asks for your WebDAV URL + API token and stores them there (the token is DPAPI-encrypted for
       your Windows user — unreadable by other users, and never leaves your machine),
    3. pre-creates the "ComputerShared" space in your Drive,
    4. adds an "OpenCoperLock" entry (with the logo) to Explorer's right-click "Send to" menu.

  After this, right-click any file(s) -> Send to -> OpenCoperLock uploads them to ComputerShared.

  Run:  right-click install-windows.cmd, or
        powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
#>
[CmdletBinding()]
param(
  [string]$Base,
  [string]$Token
)
$ErrorActionPreference = 'Stop'

# Files come from the local checkout when run from one, or from the official repo when this script
# is piped straight from the web (irm ... | iex), so a one-line install works either way.
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

# --- install files -------------------------------------------------------------------------------
Get-Component 'windows/send.ps1' (Join-Path $dstDir 'send.ps1')
Get-Component 'assets/opencoperlock.ico' (Join-Path $dstDir 'opencoperlock.ico')

# DPAPI-encrypt the token (current-user scope) and write the config.
$enc = ConvertTo-SecureString $Token -AsPlainText -Force | ConvertFrom-SecureString
[pscustomobject]@{ base = $Base; token = $enc } | ConvertTo-Json | Set-Content (Join-Path $dstDir 'config.json') -Encoding UTF8

# --- pre-create the ComputerShared space ---------------------------------------------------------
try { & curl.exe -s -u "me:$Token" -X MKCOL "$Base/ComputerShared/" | Out-Null } catch { }
$Token = $null

# --- Send To shortcut ----------------------------------------------------------------------------
$sendTo = [Environment]::GetFolderPath('SendTo')
$lnkPath = Join-Path $sendTo 'OpenCoperLock.lnk'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnkPath)
$sc.TargetPath   = $ps
$sc.Arguments    = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $dstDir 'send.ps1') + '"'
$sc.IconLocation = (Join-Path $dstDir 'opencoperlock.ico') + ',0'
$sc.Description  = 'Send to OpenCoperLock (ComputerShared)'
$sc.WorkingDirectory = $dstDir
$sc.Save()

Write-Host ""
Write-Host "Installed. Right-click any file(s) -> Send to -> OpenCoperLock." -ForegroundColor Green
Write-Host "Uploads land in the 'ComputerShared' space of your Drive." -ForegroundColor DarkGray
Write-Host "To change the URL/token later, just run this installer again." -ForegroundColor DarkGray
