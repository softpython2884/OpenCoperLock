<#
  OpenCoperLock - mount your Drive as a Windows network drive over WebDAV.

  Windows' built-in WebDAV client (the "WebClient" service) needs a few registry tweaks before it
  behaves, and it mislabels the mount. This script does the whole thing in one shot:

    1. Configures the WebClient service (Basic-over-HTTPS, raises the 50 MB download cap, longer
       timeout) - this part self-elevates to Administrator.
    2. Restarts WebClient so the settings take effect and its "not a WebDAV server" cache is cleared.
    3. Maps your Drive to a drive letter (default X:) that reconnects at logon.
    4. Gives the drive a proper label instead of Windows' ugly default ("dav").

  USAGE (right-click the .cmd wrapper -> it calls this, or run directly):

    powershell -ExecutionPolicy Bypass -File .\mount-opencoperlock-windows.ps1 `
        -Server copper.forgenet.fr -Drive X -Token ocl_XXXXXXXX -Label "OpenCoperLock"

  The token is your PERSONAL API token (Account -> API tokens) - an unrestricted one; folder-scoped
  tokens are refused by WebDAV. If you omit -Token the script prompts for it.

  NOTE ON "free space": Windows often shows your LOCAL C: drive's size on a WebDAV mount instead of
  your account quota. That's a Windows limitation - the server does report the correct quota. Your
  real usage is always shown in the web app.
#>
[CmdletBinding()]
param(
  [string]$Server   = "copper.forgenet.fr",
  [string]$BasePath = "/api/dav",
  [string]$Drive    = "X",
  [string]$Token,
  [string]$User     = "me",
  [string]$Label    = "OpenCoperLock",
  # Internal: set when the script relaunches itself elevated to do only the registry/service part.
  [switch]$ConfigureOnly
)

$ErrorActionPreference = "Stop"
$Drive = $Drive.TrimEnd(":")

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltinRole]::Administrator)
}

# -- Phase A: the Administrator-only part (registry + service) ---------------------------------
function Set-WebClientConfig {
  $p = "HKLM:\SYSTEM\CurrentControlSet\Services\WebClient\Parameters"
  Set-ItemProperty $p -Name BasicAuthLevel           -Value 2          -Type DWord
  Set-ItemProperty $p -Name FileSizeLimitInBytes     -Value 0xFFFFFFFF -Type DWord  # ~4 GB (was 50 MB)
  Set-ItemProperty $p -Name FsCtlRequestTimeoutInSec -Value 300        -Type DWord
  Set-Service WebClient -StartupType Automatic
  Restart-Service WebClient -Force
  Write-Host "[ok] WebClient configured and restarted." -ForegroundColor Green
}

if ($ConfigureOnly) {
  # We are the elevated child: do only the privileged part, then exit.
  Set-WebClientConfig
  return
}

# -- Phase B: the normal-user part (mapping must NOT run elevated, or Explorer won't see it) -----
if (-not $Token) { $Token = Read-Host "Paste your OpenCoperLock API token (ocl_...)" }
if (-not $Token) { throw "No token provided." }

Write-Host "Configuring the WebClient service (a UAC prompt will appear)..." -ForegroundColor Cyan
$childArgs = @(
  "-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`"","-ConfigureOnly",
  "-Server",$Server,"-BasePath",$BasePath
)
$proc = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $childArgs -Wait -PassThru
if ($proc.ExitCode -ne 0) { Write-Warning "The elevated configuration step reported an error; continuing to the mount anyway." }

# The @SSL UNC form routes reliably through the WebDAV redirector over HTTPS on port 443.
$uncPath = "\\$Server@SSL" + ($BasePath -replace "/","\")

# Drop any stale mapping on that letter first (ignore "not connected" errors).
& net.exe use "$($Drive):" /delete /y 2>$null | Out-Null

Write-Host "Mapping $($Drive): -> $uncPath ..." -ForegroundColor Cyan
& net.exe use "$($Drive):" $uncPath /user:$User $Token /persistent:yes
if ($LASTEXITCODE -ne 0) {
  throw "net use failed (exit $LASTEXITCODE). Make sure the WebClient service is running and the token is valid."
}

# Give the drive a human label instead of Windows' default ("dav") via MountPoints2.
try {
  $mangled = "##" + (($uncPath.TrimStart("\")) -replace "[\\/]","#")
  $mp = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\MountPoints2\$mangled"
  New-Item -Path $mp -Force | Out-Null
  Set-ItemProperty -Path $mp -Name "_LabelFromReg" -Value $Label
  Write-Host "[ok] Drive labelled '$Label'." -ForegroundColor Green
} catch {
  Write-Warning "Could not set the drive label (cosmetic only): $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Done. Your Drive is mounted at $($Drive): - open 'This PC'." -ForegroundColor Green
Write-Host "(Windows may show your local disk size for 'free space'; that's a Windows quirk, not your real quota.)" -ForegroundColor DarkGray
