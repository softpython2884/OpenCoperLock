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

   Paste your WebDAV URL (e.g. `https://copper.forgenet.fr/api/dav`) and the token when asked.
3. Done — right-click any file(s) → **Send to → OpenCoperLock**.

The installer copies `send.ps1` + the icon into `%LOCALAPPDATA%\OpenCoperLock`, stores your token
**DPAPI-encrypted** (readable only by your Windows user, never leaves the machine), pre-creates the
`ComputerShared` space, and drops the shortcut into your *Send To* folder (`shell:sendto`).
Re-run the installer any time to change the URL/token. To uninstall, delete the shortcut from
`shell:sendto` and the `%LOCALAPPDATA%\OpenCoperLock` folder.

> Uses `curl.exe`, which ships with Windows 10 1803+ and Windows 11.

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
