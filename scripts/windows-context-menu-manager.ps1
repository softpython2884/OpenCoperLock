<#
  OpenCoperLock - Windows right-click menu manager.

  A simple, SAFE, reversible tool to tidy the Explorer right-click menu that apps keep cluttering.
  It lists two kinds of entries and lets you turn any of them on/off:

    - Classic verbs        (...\shell\<verb>)              - disabled with a `LegacyDisable` flag.
    - Shell-extension items (...\shellex\ContextMenuHandlers) - disabled via Windows' official
                                                             "Shell Extensions\Blocked" list.

  NOTHING is deleted - disabling just sets a flag, so you can re-enable anything later. Writing to
  the system-wide (HKLM) entries needs Administrator; run the .cmd wrapper (it elevates) to manage
  everything. Per-user (HKCU) entries work without elevation.

  Usage:  right-click windows-context-menu-manager.cmd  (recommended, elevates)
          or: powershell -ExecutionPolicy Bypass -File .\windows-context-menu-manager.ps1
#>
$ErrorActionPreference = 'Stop'

$BlockedKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}
$IsAdmin = Test-Admin

$verbRoots = @(
  '*\shell', 'AllFilesystemObjects\shell', 'Directory\shell',
  'Directory\Background\shell', 'Folder\shell'
)
$hives = @{ 'HKCU' = 'HKCU:\Software\Classes'; 'HKLM' = 'HKLM:\SOFTWARE\Classes' }

function Get-Entries {
  $list = New-Object System.Collections.ArrayList
  foreach ($h in $hives.GetEnumerator()) {
    foreach ($vr in $verbRoots) {
      # --- classic verbs (paths may contain the literal "*" key -> -LiteralPath everywhere) ---
      $base = Join-Path $h.Value $vr
      if (Test-Path -LiteralPath $base) {
        foreach ($k in Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue) {
          $props = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
          $name = $props.MUIVerb; if (-not $name) { $name = $props.'(default)' }; if (-not $name) { $name = $k.PSChildName }
          [void]$list.Add([pscustomobject]@{
            Type = 'verb'; Scope = $h.Key; Name = "$name"; Where = $vr
            Path = $k.PSPath; Enabled = -not ($props.PSObject.Properties.Name -contains 'LegacyDisable')
          })
        }
      }
      # --- shell-extension handlers ---
      $shx = Join-Path $h.Value ("$vr" -replace '\\shell$', '\shellex\ContextMenuHandlers')
      if (Test-Path -LiteralPath $shx) {
        foreach ($k in Get-ChildItem -LiteralPath $shx -ErrorAction SilentlyContinue) {
          $clsid = (Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue).'(default)'
          if (-not $clsid) { $clsid = $k.PSChildName }
          $friendly = $k.PSChildName
          if ($clsid -match '^{.+}$') {
            $cn = (Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Classes\CLSID\$clsid" -ErrorAction SilentlyContinue).'(default)'
            if ($cn) { $friendly = $cn }
          }
          $blocked = $false
          if ($clsid -match '^{.+}$' -and (Test-Path -LiteralPath $BlockedKey)) {
            $blocked = ($null -ne (Get-ItemProperty -LiteralPath $BlockedKey -ErrorAction SilentlyContinue).$clsid)
          }
          [void]$list.Add([pscustomobject]@{
            Type = 'shellex'; Scope = $h.Key; Name = "$friendly"; Where = ($vr -replace '\\shell$', '')
            Path = $k.PSPath; Clsid = "$clsid"; Enabled = -not $blocked
          })
        }
      }
    }
  }
  # Hide our own entries and stable Windows built-ins would be noisy; keep everything but sort.
  $list | Sort-Object @{e = 'Enabled'; Descending = $true }, Scope, Where, Name
}

function Toggle-Entry($e) {
  if ($e.Scope -eq 'HKLM' -and -not $IsAdmin) {
    Write-Host "  ! '$($e.Name)' is system-wide (HKLM) - re-run the .cmd as Administrator to change it." -ForegroundColor Yellow
    return
  }
  if ($e.Type -eq 'verb') {
    if ($e.Enabled) { New-ItemProperty -LiteralPath $e.Path -Name 'LegacyDisable' -Value '' -PropertyType String -Force | Out-Null }
    else { Remove-ItemProperty -LiteralPath $e.Path -Name 'LegacyDisable' -ErrorAction SilentlyContinue }
  } else {
    if ($e.Clsid -notmatch '^{.+}$') { Write-Host "  ! '$($e.Name)' has no CLSID - cannot toggle." -ForegroundColor Yellow; return }
    if (-not $IsAdmin) { Write-Host "  ! Shell-extension toggles need Administrator." -ForegroundColor Yellow; return }
    if (-not (Test-Path $BlockedKey)) { New-Item $BlockedKey -Force | Out-Null }
    if ($e.Enabled) { New-ItemProperty $BlockedKey -Name $e.Clsid -Value $e.Name -PropertyType String -Force | Out-Null }
    else { Remove-ItemProperty $BlockedKey -Name $e.Clsid -ErrorAction SilentlyContinue }
  }
  $action = if ($e.Enabled) { 'Disabled' } else { 'Enabled' }
  Write-Host ("  {0} '{1}'" -f $action, $e.Name) -ForegroundColor Green
}

# --- interactive loop ----------------------------------------------------------------------------
Write-Host "OpenCoperLock - right-click menu manager" -ForegroundColor Cyan
if (-not $IsAdmin) { Write-Host "(not elevated - system-wide entries are read-only; run the .cmd to elevate)" -ForegroundColor DarkGray }

while ($true) {
  $entries = @(Get-Entries)
  Write-Host ""
  for ($i = 0; $i -lt $entries.Count; $i++) {
    $e = $entries[$i]
    $mark = if ($e.Enabled) { '[on ]' } else { '[OFF]' }
    $col  = if ($e.Enabled) { 'Gray' } else { 'DarkGray' }
    Write-Host ("{0,3}. {1} {2,-7} {3,-28} {4} ({5})" -f ($i + 1), $mark, $e.Scope, $e.Name, $e.Where, $e.Type) -ForegroundColor $col
  }
  Write-Host ""
  $inp = Read-Host "Numbers to toggle (comma-separated), R to refresh, Q to quit"
  if ($inp -match '^[Qq]') { break }
  if ($inp -match '^[Rr]') { continue }
  foreach ($tok in ($inp -split '[,\s]+' | Where-Object { $_ })) {
    if ($tok -match '^\d+$') {
      $idx = [int]$tok - 1
      if ($idx -ge 0 -and $idx -lt $entries.Count) { Toggle-Entry $entries[$idx] }
    }
  }
}

Write-Host ""
Write-Host "Done. Restart Explorer (or sign out/in) for changes to fully apply." -ForegroundColor Green
Write-Host "Tip: 'taskkill /f /im explorer.exe & start explorer.exe' restarts it immediately." -ForegroundColor DarkGray
