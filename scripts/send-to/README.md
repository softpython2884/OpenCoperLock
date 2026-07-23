# Send to OpenCoperLock

Right-click a file in your OS file manager → **Send to → OpenCoperLock** → it uploads straight into
a space called **`ComputerShared`** in your Drive. Works on **Windows** and **Linux**, uses the
brand logo in the menu, and remembers your server + token so every send is one click.

Under the hood it uploads over **WebDAV** (the same endpoint the account page shows), so there's no
new server code — just your existing `ocl_…` API token.

---

## Windows

1. Get an **unrestricted API token**: web app → *Account → API tokens* (folder-scoped tokens are
   refused by WebDAV).
2. Install, either way (no admin needed):
   - **One-liner** — in PowerShell:
     ```powershell
     irm https://raw.githubusercontent.com/softpython2884/OpenCoperLock/main/scripts/send-to/windows/install-windows.ps1 | iex
     ```
   - **Or** double-click **`windows/install-windows.cmd`** from a checkout.

   Paste your WebDAV URL (e.g. `https://copper.forgenet.fr/api/dav`) and the token when asked, then
   pick your options (notification on/off; *Send to* menu; *Drop on OpenCoperLock* right-click entry).
3. Done. Depending on your choices, right-click any file(s) →
   - **Send to → OpenCoperLock** — uploads **all** selected files in one go, or
   - **Drop on OpenCoperLock** — a top-level right-click entry (handles one file or several).

Everything runs **hidden** (a tiny `launch.vbs` starts the uploader with no PowerShell window) and
shows a small tray notification when done. The installer stores your token **DPAPI-encrypted**
(readable only by your Windows user, never leaves the machine), pre-creates the `ComputerShared`
space, and writes a `%LOCALAPPDATA%\OpenCoperLock\send.log` you can check if an upload misbehaves.
Re-run the installer any time to change settings. To uninstall: re-run and answer *no* to the
integrations (or delete the `shell:sendto\OpenCoperLock.lnk`, the `HKCU:\Software\Classes\*\shell\
OpenCoperLock.*` keys, and the `%LOCALAPPDATA%\OpenCoperLock` folder).

> Uses `curl.exe`, which ships with Windows 10 1803+ and Windows 11.

### Bonus: tidy your right-click menu

Apps love to pile entries into the Explorer context menu. `scripts/windows-context-menu-manager.cmd`
(double-click; it elevates) lists every classic verb **and** shell-extension entry and lets you
turn any of them on/off. Nothing is deleted — disabling just sets a reversible flag, so you can
re-enable anything later.

## Linux

1. Get an unrestricted API token (as above).
2. Install with the one-liner:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/softpython2884/OpenCoperLock/main/scripts/send-to/linux/install-linux.sh | bash
   ```
   (or run **`linux/install-linux.sh`** from a checkout), then paste your WebDAV URL + token.
3. Right-click a file:
   - **GNOME Files / Cinnamon:** *Scripts → Send to OpenCoperLock*
   - **KDE Dolphin:** *Send to OpenCoperLock* (top of the menu)

Config is stored at `~/.config/opencoperlock/config` (`chmod 600`). If the entry doesn't show up,
restart the file manager (`nautilus -q`, `nemo -q`, or log out/in on KDE). Requires `curl`;
notifications use `notify-send` if present.

---

## The icon

`assets/opencoperlock.ico` / `.png` are rasterized from the app's real brand SVG
(`apps/web/public/icon-maskable.svg`) — the violet-gradient padlock — by
`assets/generate-icons.py`. The SVG is the source of truth and is never modified; regenerate with:

```bash
pip install cairosvg pillow
python3 scripts/send-to/assets/generate-icons.py
```

## Security notes

- Uploads go to **`ComputerShared`**, a normal (server-encrypted) top-level folder in **your**
  Drive. Nothing is made public.
- The token grants WebDAV access to your Drive — keep it unrestricted but private. Revoke it from
  *Account → API tokens* if it leaks; re-run the installer with a fresh one.
