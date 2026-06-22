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
</content>
