<#
  OpenCoperLock - quick declutter for the Windows 11 right-click menu.

  Disables the noisy app entries you named (Edit with Photos, Create with Designer, Edit with Paint,
  Ask Copilot) - matched by keyword so it works in French or English. It scans the places these
  live: classic verbs and shell-extension handlers under the file/folder roots AND under
  SystemFileAssociations\image\... (where "Edit with Photos/Paint" hide).

  NOTHING is deleted - verbs get a reversible `LegacyDisable` flag and shell extensions go on
  Windows' official "Blocked" list. Re-enable later with -Restore (same keywords) or the GUI manager.

  Usage:
    windows-declutter.cmd                 # disable the default noisy set (asks to confirm)
    ...ps1 -List                          # just show what matches, change nothing
    ...ps1 -Keywords Photos,Paint         # target your own keywords
    ...ps1 -Restore                       # re-enable everything matching the keywords
#>
param(
  [string[]]$Keywords = @('Photos', 'Designer', 'Paint', 'Copilot'),
  [switch]$List,
  [switch]$Restore
)
$ErrorActionPreference = 'Stop'
$BlockedKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}
# Self-elevate: most of these entries are system-wide (HKLM).
if (-not (Test-Admin) -and -not $List -and $PSCommandPath) {
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Keywords', ($Keywords -join ','))
  if ($Restore) { $a += '-Restore' }
  try { Start-Process powershell -Verb RunAs -ArgumentList $a; exit } catch { }
}
$IsAdmin = Test-Admin

$imgExt = @('.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.tif', '.tiff', '.ico', '.avif')
$verbRoots = @('*\shell', 'AllFilesystemObjects\shell', 'Directory\shell', 'Directory\Background\shell',
  'Folder\shell', 'SystemFileAssociations\image\shell', 'SystemFileAssociations\text\shell') +
  ($imgExt | ForEach-Object { "SystemFileAssociations\$_\shell" })
$shexRoots = @('*', 'AllFilesystemObjects', 'Directory', 'Directory\Background', 'Folder', 'SystemFileAssociations\image')
$hives = [ordered]@{ 'HKCU' = 'HKCU:\Software\Classes'; 'HKLM' = 'HKLM:\SOFTWARE\Classes' }

function Matches($text) {
  foreach ($kw in $Keywords) { if ("$text" -match [regex]::Escape($kw)) { return $true } }
  return $false
}

function Find-Candidates {
  $out = New-Object System.Collections.ArrayList
  foreach ($h in $hives.GetEnumerator()) {
    foreach ($vr in $verbRoots) {
      $base = Join-Path $h.Value $vr
      if (-not (Test-Path -LiteralPath $base)) { continue }
      foreach ($k in Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue) {
        $props = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
        $name = $props.MUIVerb; if (-not $name) { $name = $props.'(default)' }; if (-not $name) { $name = $k.PSChildName }
        if ((Matches $name) -or (Matches $k.PSChildName)) {
          [void]$out.Add([pscustomobject]@{ Type = 'verb'; Scope = $h.Key; Name = "$name"; Where = $vr
              Path = $k.PSPath; Clsid = ''; Disabled = ($props.PSObject.Properties.Name -contains 'LegacyDisable') })
        }
      }
    }
    foreach ($sr in $shexRoots) {
      $base = Join-Path $h.Value "$sr\shellex\ContextMenuHandlers"
      if (-not (Test-Path -LiteralPath $base)) { continue }
      foreach ($k in Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue) {
        $clsid = (Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue).'(default)'
        if (-not $clsid) { $clsid = $k.PSChildName }
        $friendly = $k.PSChildName
        if ($clsid -match '^{.+}$') {
          $cn = (Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Classes\CLSID\$clsid" -ErrorAction SilentlyContinue).'(default)'
          if ($cn) { $friendly = $cn }
        }
        if ((Matches $friendly) -or (Matches $k.PSChildName)) {
          $blocked = $false
          if ($clsid -match '^{.+}$' -and (Test-Path -LiteralPath $BlockedKey)) {
            $blocked = ($null -ne (Get-ItemProperty -LiteralPath $BlockedKey -ErrorAction SilentlyContinue).$clsid)
          }
          [void]$out.Add([pscustomobject]@{ Type = 'shellex'; Scope = $h.Key; Name = "$friendly"; Where = $sr
              Path = $k.PSPath; Clsid = "$clsid"; Disabled = $blocked })
        }
      }
    }
  }
  $out | Sort-Object Name, Where -Unique
}

function Apply($e, $disable) {
  if ($e.Scope -eq 'HKLM' -and -not $IsAdmin) { return "needs admin" }
  try {
    if ($e.Type -eq 'verb') {
      if ($disable) { New-ItemProperty -LiteralPath $e.Path -Name 'LegacyDisable' -Value '' -PropertyType String -Force | Out-Null }
      else { Remove-ItemProperty -LiteralPath $e.Path -Name 'LegacyDisable' -ErrorAction SilentlyContinue }
    } else {
      if ($e.Clsid -notmatch '^{.+}$') { return "no CLSID" }
      if (-not (Test-Path $BlockedKey)) { New-Item $BlockedKey -Force | Out-Null }
      if ($disable) { New-ItemProperty $BlockedKey -Name $e.Clsid -Value $e.Name -PropertyType String -Force | Out-Null }
      else { Remove-ItemProperty $BlockedKey -Name $e.Clsid -ErrorAction SilentlyContinue }
    }
    return $null
  } catch { return $_.Exception.Message }
}

Write-Host "OpenCoperLock declutter - keywords: $($Keywords -join ', ')" -ForegroundColor Cyan
$cands = @(Find-Candidates)
if ($cands.Count -eq 0) { Write-Host "Nothing matched. (These entries may be part of Windows' modern menu, not the classic registry.)" -ForegroundColor Yellow; if (-not $PSCommandPath) { Read-Host "Enter to close" }; return }

Write-Host ""
$i = 0
foreach ($e in $cands) {
  $i++
  $state = if ($e.Disabled) { '[already OFF]' } else { '[on]' }
  Write-Host ("  {0,2}. {1,-12} {2,-6} {3,-34} {4} ({5})" -f $i, $state, $e.Scope, $e.Name, $e.Where, $e.Type)
}
Write-Host ""

if ($List) { return }

$verb = if ($Restore) { 're-enable' } else { 'disable' }
$ans = (Read-Host "$verb the $($cands.Count) matching entries above? [Y/n]").Trim().ToLower()
if ($ans -eq 'n' -or $ans -eq 'no' -or $ans -eq 'non') { Write-Host "Cancelled." -ForegroundColor DarkGray; return }

$done = 0; $skip = 0
foreach ($e in $cands) {
  $err = Apply $e (-not $Restore)
  if ($err) { Write-Host ("  ! {0}: {1}" -f $e.Name, $err) -ForegroundColor Yellow; $skip++ }
  else { $done++ }
}
Write-Host ""
Write-Host ("{0} {1}d, {2} skipped." -f $done, $verb, $skip) -ForegroundColor Green
Write-Host "Restart Explorer to see the change: taskkill /f /im explorer.exe & start explorer.exe" -ForegroundColor DarkGray
if (-not $PSCommandPath) { Read-Host "Enter to close" }
