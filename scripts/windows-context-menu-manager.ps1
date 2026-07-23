<#
  OpenCoperLock - Windows right-click menu manager (GUI).

  A simple, SAFE, reversible tool to tidy the Explorer right-click menu that apps keep cluttering.
  It lists two kinds of entries and lets you tick/untick each one:

    - Classic verbs         (...\shell\<verb>)               -> disabled with a `LegacyDisable` flag.
    - Shell-extension items (...\shellex\ContextMenuHandlers) -> disabled via Windows' official
                                                                "Shell Extensions\Blocked" list.

  NOTHING is deleted - unticking just sets a flag, so you can re-enable anything later. Managing the
  system-wide (HKLM) entries needs Administrator; the .cmd wrapper elevates. Per-user (HKCU) entries
  work without elevation.

  Usage:  double-click windows-context-menu-manager.cmd   (recommended, elevates + opens the window)
          -Console  runs the plain text version instead of the window.
#>
param([switch]$Console)
$ErrorActionPreference = 'Stop'

$BlockedKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}
$IsAdmin = Test-Admin

$verbRoots = @('*\shell', 'AllFilesystemObjects\shell', 'Directory\shell', 'Directory\Background\shell', 'Folder\shell')
$hives = [ordered]@{ 'HKCU' = 'HKCU:\Software\Classes'; 'HKLM' = 'HKLM:\SOFTWARE\Classes' }

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
            Path = $k.PSPath; Clsid = ''; Enabled = -not ($props.PSObject.Properties.Name -contains 'LegacyDisable')
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
  $list | Sort-Object Scope, Where, Name
}

# Returns $null on success, or an error message string. Updates $e.Enabled on success.
function Set-EntryState($e, $enable) {
  if ($e.Scope -eq 'HKLM' -and -not $IsAdmin) { return 'system-wide entry - re-run as Administrator' }
  try {
    if ($e.Type -eq 'verb') {
      if (-not $enable) { New-ItemProperty -LiteralPath $e.Path -Name 'LegacyDisable' -Value '' -PropertyType String -Force | Out-Null }
      else { Remove-ItemProperty -LiteralPath $e.Path -Name 'LegacyDisable' -ErrorAction SilentlyContinue }
    } else {
      if ($e.Clsid -notmatch '^{.+}$') { return 'no CLSID - cannot toggle' }
      if (-not $IsAdmin) { return 'shell extensions need Administrator' }
      if (-not (Test-Path $BlockedKey)) { New-Item $BlockedKey -Force | Out-Null }
      if (-not $enable) { New-ItemProperty $BlockedKey -Name $e.Clsid -Value $e.Name -PropertyType String -Force | Out-Null }
      else { Remove-ItemProperty $BlockedKey -Name $e.Clsid -ErrorAction SilentlyContinue }
    }
    $e.Enabled = $enable
    return $null
  } catch { return $_.Exception.Message }
}

# ================================ GUI ============================================================
function Show-Gui {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $script:all = @(Get-Entries)
  $script:suppress = $false

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "OpenCoperLock - Menu clic droit"
  $form.Size = New-Object System.Drawing.Size(940, 620)
  $form.StartPosition = 'CenterScreen'
  $form.MinimumSize = New-Object System.Drawing.Size(640, 400)
  $form.BackColor = [System.Drawing.Color]::FromArgb(21, 21, 29)
  $form.ForeColor = [System.Drawing.Color]::White

  # --- top bar: search + admin badge ---
  $top = New-Object System.Windows.Forms.Panel
  $top.Dock = 'Top'; $top.Height = 46; $top.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 38)
  $lblFind = New-Object System.Windows.Forms.Label
  $lblFind.Text = "Filtrer :"; $lblFind.AutoSize = $true; $lblFind.Location = New-Object System.Drawing.Point(12, 14)
  $txt = New-Object System.Windows.Forms.TextBox
  $txt.Location = New-Object System.Drawing.Point(70, 11); $txt.Width = 320
  $txt.BackColor = [System.Drawing.Color]::FromArgb(15, 15, 20); $txt.ForeColor = [System.Drawing.Color]::White
  $badge = New-Object System.Windows.Forms.Label
  $badge.AutoSize = $true; $badge.Location = New-Object System.Drawing.Point(410, 14)
  if ($IsAdmin) { $badge.Text = "Administrateur : tout est modifiable"; $badge.ForeColor = [System.Drawing.Color]::FromArgb(120, 220, 140) }
  else { $badge.Text = "Non administrateur : entrees systeme (HKLM) en lecture seule"; $badge.ForeColor = [System.Drawing.Color]::FromArgb(240, 200, 120) }
  $top.Controls.AddRange(@($lblFind, $txt, $badge))

  # --- grid ---
  $grid = New-Object System.Windows.Forms.DataGridView
  $grid.Dock = 'Fill'
  $grid.BackgroundColor = [System.Drawing.Color]::FromArgb(21, 21, 29)
  $grid.GridColor = [System.Drawing.Color]::FromArgb(50, 50, 60)
  $grid.BorderStyle = 'None'; $grid.EnableHeadersVisualStyles = $false
  $grid.AllowUserToAddRows = $false; $grid.AllowUserToDeleteRows = $false
  $grid.RowHeadersVisible = $false; $grid.SelectionMode = 'FullRowSelect'
  $grid.AutoSizeColumnsMode = 'Fill'; $grid.MultiSelect = $false
  $grid.ColumnHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 38)
  $grid.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::White
  $grid.DefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(21, 21, 29)
  $grid.DefaultCellStyle.ForeColor = [System.Drawing.Color]::White
  $grid.DefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(60, 45, 90)

  $colOn = New-Object System.Windows.Forms.DataGridViewCheckBoxColumn
  $colOn.HeaderText = "Actif"; $colOn.Width = 55; $colOn.FillWeight = 8
  $c1 = New-Object System.Windows.Forms.DataGridViewTextBoxColumn; $c1.HeaderText = "Portee"; $c1.ReadOnly = $true; $c1.FillWeight = 10
  $c2 = New-Object System.Windows.Forms.DataGridViewTextBoxColumn; $c2.HeaderText = "Nom"; $c2.ReadOnly = $true; $c2.FillWeight = 40
  $c3 = New-Object System.Windows.Forms.DataGridViewTextBoxColumn; $c3.HeaderText = "S'applique a"; $c3.ReadOnly = $true; $c3.FillWeight = 30
  $c4 = New-Object System.Windows.Forms.DataGridViewTextBoxColumn; $c4.HeaderText = "Type"; $c4.ReadOnly = $true; $c4.FillWeight = 12
  [void]$grid.Columns.AddRange(@($colOn, $c1, $c2, $c3, $c4))

  function Fill-Grid {
    $filter = $txt.Text.Trim()
    $script:suppress = $true
    $grid.Rows.Clear()
    foreach ($e in $script:all) {
      if ($filter -and ($e.Name -notmatch [regex]::Escape($filter)) -and ($e.Where -notmatch [regex]::Escape($filter))) { continue }
      $i = $grid.Rows.Add(@($e.Enabled, $e.Scope, $e.Name, $e.Where, $e.Type))
      $grid.Rows[$i].Tag = $e
      if (-not $e.Enabled) { $grid.Rows[$i].DefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(130, 130, 140) }
      if ($e.Scope -eq 'HKLM' -and -not $IsAdmin) { $grid.Rows[$i].Cells[0].ReadOnly = $true }
    }
    $script:suppress = $false
  }

  $grid.add_CurrentCellDirtyStateChanged({
      if ($grid.IsCurrentCellDirty -and $grid.CurrentCell -is [System.Windows.Forms.DataGridViewCheckBoxCell]) {
        $grid.CommitEdit([System.Windows.Forms.DataGridViewDataErrorContexts]::Commit)
      }
    })
  $grid.add_CellValueChanged({
      param($sender, $e)
      if ($script:suppress -or $e.RowIndex -lt 0 -or $e.ColumnIndex -ne 0) { return }
      $row = $grid.Rows[$e.RowIndex]; $entry = $row.Tag
      if (-not $entry) { return }
      $want = [bool]$row.Cells[0].Value
      if ($want -eq $entry.Enabled) { return }
      $err = Set-EntryState $entry $want
      if ($err) {
        [System.Windows.Forms.MessageBox]::Show("Impossible de modifier '$($entry.Name)' :`n$err", "OpenCoperLock", 'OK', 'Warning') | Out-Null
        $script:suppress = $true; $row.Cells[0].Value = $entry.Enabled; $script:suppress = $false
      } else {
        $status.Text = ("{0} : {1}" -f $(if ($want) { 'Active' } else { 'Desactive' }), $entry.Name)
        $row.DefaultCellStyle.ForeColor = if ($entry.Enabled) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(130, 130, 140) }
      }
    })
  $txt.add_TextChanged({ Fill-Grid })

  # --- bottom bar ---
  $bottom = New-Object System.Windows.Forms.Panel
  $bottom.Dock = 'Bottom'; $bottom.Height = 52; $bottom.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 38)
  $status = New-Object System.Windows.Forms.Label
  $status.AutoSize = $true; $status.Location = New-Object System.Drawing.Point(14, 18)
  $status.ForeColor = [System.Drawing.Color]::FromArgb(170, 170, 180)
  $status.Text = "Coche / decoche une entree pour l'activer / la desactiver. Rien n'est supprime."

  $btnRefresh = New-Object System.Windows.Forms.Button
  $btnRefresh.Text = "Rafraichir"; $btnRefresh.Width = 100; $btnRefresh.Height = 30
  $btnRefresh.FlatStyle = 'Flat'; $btnRefresh.ForeColor = [System.Drawing.Color]::White
  $btnRestart = New-Object System.Windows.Forms.Button
  $btnRestart.Text = "Redemarrer l'explorateur"; $btnRestart.Width = 190; $btnRestart.Height = 30
  $btnRestart.FlatStyle = 'Flat'; $btnRestart.ForeColor = [System.Drawing.Color]::White
  $btnClose = New-Object System.Windows.Forms.Button
  $btnClose.Text = "Fermer"; $btnClose.Width = 90; $btnClose.Height = 30
  $btnClose.FlatStyle = 'Flat'; $btnClose.ForeColor = [System.Drawing.Color]::White

  $btnRefresh.add_Click({ $script:all = @(Get-Entries); Fill-Grid; $status.Text = "Liste rafraichie." })
  $btnRestart.add_Click({
      Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 400; if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }
      $status.Text = "Explorateur redemarre - le menu est a jour."
    })
  $btnClose.add_Click({ $form.Close() })

  $bottom.add_Resize({
      $btnClose.Location = New-Object System.Drawing.Point(($bottom.Width - 104), 11)
      $btnRestart.Location = New-Object System.Drawing.Point(($bottom.Width - 304), 11)
      $btnRefresh.Location = New-Object System.Drawing.Point(($bottom.Width - 412), 11)
    })
  $bottom.Controls.AddRange(@($status, $btnRefresh, $btnRestart, $btnClose))

  $form.Controls.Add($grid); $form.Controls.Add($top); $form.Controls.Add($bottom)
  Fill-Grid
  $btnClose.Location = New-Object System.Drawing.Point(($bottom.Width - 104), 11)
  $btnRestart.Location = New-Object System.Drawing.Point(($bottom.Width - 304), 11)
  $btnRefresh.Location = New-Object System.Drawing.Point(($bottom.Width - 412), 11)
  [void]$form.ShowDialog()
}

# ============================== console fallback =================================================
function Show-Console {
  Write-Host "OpenCoperLock - right-click menu manager" -ForegroundColor Cyan
  if (-not $IsAdmin) { Write-Host "(not elevated - HKLM entries read-only; run the .cmd to elevate)" -ForegroundColor DarkGray }
  while ($true) {
    $entries = @(Get-Entries)
    Write-Host ""
    for ($i = 0; $i -lt $entries.Count; $i++) {
      $e = $entries[$i]; $mark = if ($e.Enabled) { '[on ]' } else { '[OFF]' }
      Write-Host ("{0,3}. {1} {2,-5} {3,-30} {4} ({5})" -f ($i + 1), $mark, $e.Scope, $e.Name, $e.Where, $e.Type)
    }
    $inp = Read-Host "`nNumbers to toggle, R refresh, Q quit"
    if ($inp -match '^[Qq]') { break }
    if ($inp -match '^[Rr]') { continue }
    foreach ($tok in ($inp -split '[,\s]+' | Where-Object { $_ })) {
      if ($tok -match '^\d+$') {
        $idx = [int]$tok - 1
        if ($idx -ge 0 -and $idx -lt $entries.Count) {
          $e = $entries[$idx]; $err = Set-EntryState $e (-not $e.Enabled)
          if ($err) { Write-Host "  ! $($e.Name): $err" -ForegroundColor Yellow }
          else { Write-Host ("  {0} '{1}'" -f $(if ($e.Enabled) { 'Enabled' } else { 'Disabled' }), $e.Name) -ForegroundColor Green }
        }
      }
    }
  }
  Write-Host "`nDone. Restart Explorer for changes to apply." -ForegroundColor Green
}

if ($Console) { Show-Console } else { Show-Gui }
