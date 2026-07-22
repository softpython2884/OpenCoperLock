# OpenCoperLock REST API (v1)

A small REST API to automate **your own** account — upload, list and download files in your
normal (non-vault) folders from scripts, backups, CI, IoT devices, etc.

> Zero-Knowledge vaults are encrypted in your browser, so the server-side API cannot read or
> write them. The API only reaches normal (server-encrypted) folders.

## Authentication

Create a token in **Account ▸ API tokens**. You choose:

- **Scopes** — `read` (list/download) and/or `write` (upload, create folders).
- **Folder** — optionally restrict the token to a single folder.
- **Expiry** — optional lifetime in days.

The token (`ocl_…`) is shown **once**. Only a hash is stored server-side. Send it as a bearer:

```
Authorization: Bearer ocl_xxxxxxxxxxxxxxxxxxxxxxxx
```

There is no cookie and no CSRF token involved on this path.

## Endpoints

Base URL: the API origin (e.g. `https://your-host` — same origin the app calls).

| Method | Path | Scope | Description |
| ------ | ---- | ----- | ----------- |
| GET  | `/api/v1/me` | read | Confirm the token and show its scopes/folder. |
| GET  | `/api/v1/folders` | read | List your folders. |
| POST | `/api/v1/folders` | write | Create a folder: JSON `{ "name": "...", "parentId": null }`. |
| GET  | `/api/v1/files?folderId=<id>` | read | List files in a folder (omit `folderId` for the root). |
| POST | `/api/v1/files?folderId=<id>` | write | Upload one file (`multipart/form-data`, field `file`). |
| GET  | `/api/v1/files/<id>/download` | read | Download a file's contents. |

## Examples

```bash
HOST="https://your-host"
TOKEN="ocl_xxxxxxxxxxxxxxxxxxxxxxxx"

# Check the token
curl -H "Authorization: Bearer $TOKEN" "$HOST/api/v1/me"

# List folders, then upload into one
curl -H "Authorization: Bearer $TOKEN" "$HOST/api/v1/folders"
curl -H "Authorization: Bearer $TOKEN" -F "file=@backup.tar.gz" \
  "$HOST/api/v1/files?folderId=<FOLDER_ID>"

# Download a file
curl -H "Authorization: Bearer $TOKEN" -OJ "$HOST/api/v1/files/<FILE_ID>/download"
```

## Notes

- Uploads count against your storage quota and are scanned by the antivirus, exactly like the web app.
- Re-uploading a text file under the same name keeps the previous content as a version.
- The REST API (and WebDAV) only expose your **personal** Drive. Zero-Knowledge vaults and
  **Shared Spaces** are intentionally out of scope — vaults are blind to the server, and a shared
  space is reachable only through the web app, gated by your membership of that space.
- Errors: `401` invalid/expired token, `403` missing scope or wrong folder, `404` not found,
  `413` quota exceeded, `422` file rejected by antivirus.

## Webhooks

In **Account ▸ Webhooks**, register a URL to receive a `POST` when a file lands in your storage
(optionally limited to one folder). Body:

```json
{ "event": "file.created", "at": "2026-06-22T12:00:00.000Z", "file": { "id": "…", "name": "…", "sizeBytes": 123, "mimeType": "…" } }
```

If you set a secret, the body is signed: `X-OpenCoperLock-Signature: sha256=<hex>` (HMAC-SHA256
of the raw body). Targets must be public URLs (localhost/private addresses are rejected).

## WebDAV

Mount your normal spaces as a network drive (Finder, Windows Explorer, `rsync`/davfs, Cyberduck).

- **URL:** `<HOST>/dav/`
- **Username:** anything (your email) — it is ignored.
- **Password:** an API token (`read` + `write`).

```bash
# Example with rclone
rclone config create ocl webdav url "$HOST/dav/" vendor other user me pass "$TOKEN"
rclone copy ./photos ocl:Photos
```

Notes: vault (Zero-Knowledge) folders are not exposed; `COPY` (drag-duplicate) isn't implemented
yet (`MOVE`/rename works); locking is accepted but advisory.

### Behind nginx

The reverse proxy must pass WebDAV's custom methods, the `Authorization` header, and large
uploads through to the API. If the API is exposed under `/api`, mount WebDAV there:

```nginx
# WebDAV needs custom verbs (PROPFIND, MKCOL, MOVE, LOCK…), auth passthrough and big bodies.
location /api/ {
    proxy_pass http://127.0.0.1:4000/;   # trailing slash strips /api → API sees /dav/
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization     $http_authorization;  # forward Basic creds
    proxy_set_header X-Forwarded-Prefix /api;  # so WebDAV hrefs keep the /api prefix
    proxy_pass_request_headers on;
    client_max_body_size 0;        # no upload size cap at the proxy
    proxy_request_buffering off;   # stream PUT bodies straight through
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

The WebDAV URL is then `https://<host>/api/dav/` (exactly what the account page shows — copy it
from there rather than typing it).

> The `X-Forwarded-Prefix` header is important: without it the server emits `/dav/…` hrefs, and
> clients that strip `/api` can list the root but fail to open folders. With it, hrefs become
> `/api/dav/…` and navigation works.

### Naming the drive

The name a client shows for the mount depends on the client:

- **Finder / Cyberduck / GNOME** use the server's advertised name. Set `WEBDAV_NAME` in `.env`
  (default `OpenCoper`) and reconnect — the mount is labelled with that.
- **Windows Explorer ignores the advertised name** and labels the mapped drive from the **last
  segment of the URL** you mounted. So `…/api/dav/` shows up as *“dav (\\host@SSL\DavWWWRoot\…)”*.
  To get a custom label like **OpenCoper**, expose WebDAV under a path ending in that word and
  mount *that* URL — the server already rewrites hrefs from `X-Forwarded-Prefix`. **The guided
  installer (`scripts/setup-wizard.sh`) already adds this `/OpenCoper/` location for you**; mount
  `https://<host>/OpenCoper/`. To wire it by hand:

  ```nginx
  # Mount https://<host>/OpenCoper/  →  Windows labels the drive "OpenCoper"
  location /OpenCoper/ {
      proxy_pass http://127.0.0.1:4000/dav/;        # trailing slash → API sees /dav/
      proxy_set_header Host               $host;
      proxy_set_header Authorization      $http_authorization;
      proxy_set_header X-Forwarded-Proto  $scheme;
      proxy_set_header X-Forwarded-Prefix /OpenCoper;   # hrefs stay under /OpenCoper
      proxy_pass_request_headers on;
      client_max_body_size 0;
      proxy_request_buffering off;
      proxy_buffering off;
      proxy_read_timeout 3600s;
  }
  ```

  (Or simply map the drive and rename it in *This PC* — but the label above is set once, for
  everyone.)

### Diagnosing a mount that won't connect

First prove the server side works, independent of any OS client:

```bash
curl -u "me:ocl_YOUR_TOKEN" -X PROPFIND -H "Depth: 1" https://<host>/api/dav/
```

- **207 Multi-Status with XML** → server + proxy are fine; the issue is the OS client (below).
- **401 loop** → the token/Basic auth isn't reaching the API (check `Authorization` passthrough).
- **404 / 405** → the path is wrong: the proxy isn't stripping `/api`, so the API never sees `/dav`.

### Windows Explorer

Windows' built-in WebDAV client (the *WebClient* / Mini-Redirector service) is strict and its
errors are misleading — **`0x80070043` "The network name cannot be found"** almost always means
Windows never completed the WebDAV handshake, **not** that the server is down. Work through these
in order:

1. **Never use a `\\host\…` UNC path for an internet server.** `\\copper.forgenet.fr\api\dav\`
   makes Windows try **SMB (port 445)** first, which is blocked over the internet → `0x80070043`.
   Either:
   - **Map network drive** with the plain URL `https://copper.forgenet.fr/api/dav/`, **or**
   - if you must use a UNC path, use the SSL WebDAV form:
     `\\copper.forgenet.fr@SSL\api\dav\` (add `@443` after `@SSL` if you run on a non-standard port).
2. **Make sure the WebClient service is running and restart it.** It caches a "this server isn't
   WebDAV" verdict after any failed attempt — which is exactly why it works *sometimes*. Clearing
   that cache fixes most intermittent failures. In an **admin** PowerShell / CMD:
   ```
   net stop webclient & net start webclient
   ```
   (Set its startup type to *Automatic* in `services.msc` so it's always up.)
3. **Allow Basic auth over HTTPS.** Windows refuses Basic even over TLS until you set, in
   `HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters`, the DWORD
   **`BasicAuthLevel = 2`**, then restart WebClient (step 2).
4. **Raise the download size cap.** Windows refuses files larger than **50 MB** over WebDAV by
   default. In the same `Parameters` key set the DWORD **`FileSizeLimitInBytes`** to e.g.
   `4294967295` (≈4 GB, the max) and restart WebClient.
5. **Credentials:** leave the username as anything (it's ignored) and paste your **`ocl_…` API
   token as the password**. Use an *unrestricted* token — folder-scoped tokens are refused.
6. If it still won't map, prove it's Windows and not the server by testing with **rclone**,
   **Cyberduck** or **WinSCP** — if those connect (they will), it's purely a Windows-client quirk.
   You can also confirm the server from any machine:
   ```bash
   curl -u "me:ocl_YOUR_TOKEN" -X PROPFIND -H "Depth: 1" https://copper.forgenet.fr/api/dav/
   ```
   A `207 Multi-Status` with XML = the server and proxy are perfect; the ball is in Windows' court.
</content>
