# OpenCoperLock — manual test checklist

This sheet tracks what to verify after the current round of work. It is filled in as
features land. Branch: `claude/opencoplerlock-cloud-toolkit-ofdqng`.

How to run locally:

```bash
pnpm install
# Postgres reachable via DATABASE_URL, then:
pnpm --filter @opencoperlock/api prisma:migrate
pnpm --filter @opencoperlock/api db:seed
pnpm dev          # web on :3000, api on :4000
```

Automated gates (should all pass):

```bash
pnpm -r typecheck && pnpm -r lint
DATABASE_URL=postgresql://… pnpm -r test   # 40 shared + integration suite
```

---

## Already shipped (earlier rounds)

- [ ] **Drive**: upload, download (bytes match), delete frees quota, folders, breadcrumb.
- [ ] **Encryption at rest**: uploaded file on disk is ciphertext (no plaintext leak).
- [ ] **Quick-Upload**: admin creates a code; guest at `/q` uploads without login.
- [ ] **Remote-Upload**: paste a public URL → file appears; a private/localhost URL is rejected.
- [ ] **Zero-Knowledge vault**: create vault, upload (encrypted in browser), download round-trips.
- [ ] **Admin**: create user, set quota, global cap, audit log.
- [ ] **Login throttle**: 5 wrong passwords → account locked (429) with backoff.
- [ ] **Quick-Upload ban**: repeated wrong code passwords from one IP → temporary ban.
- [ ] **Rename / move**: rename and move files and folders; moving a folder into its own
      subtree is rejected.
- [ ] **Health**: `GET /ready` returns 200 when DB+storage ok; if antivirus is enabled but
      down, signed-in users see a banner.
- [ ] **Maintenance**: `POST /admin/maintenance` reconciles quota usage and prunes logs.

---

## Share links (lot 1)

Create from the Drive: each file and folder row has a **Share** button. It asks for the
access mode, view type (preview page vs raw file), an optional code, and an optional expiry,
then copies the link. Manage them under the **Shares** tab.

- [ ] **Public file share, preview page**: open the link in a private window (no login) →
      see the file name, size and a preview (image/PDF/text/audio/video), plus Download.
- [ ] **Raw file link**: choosing "raw" makes the link open the file directly (image/PDF
      shows inline; other types download).
- [ ] **Code-protected share**: the recipient is asked for the code; wrong code is refused;
      correct code reveals the file and allows download.
- [ ] **Account-only share**: a signed-out recipient is told to sign in; a signed-in user
      of the instance can open it.
- [ ] **Folder share**: the recipient page lists the folder's files, each downloadable.
- [ ] **Expiry**: a link past its expiry shows "Link expired".
- [ ] **Max downloads**: after the limit, further downloads return "expired" (inline
      previews don't count toward the limit).
- [ ] **Revoke**: revoking in the Shares tab makes the link 404 immediately.
- [ ] **ZK guard**: a vault file/folder cannot be shared (the Share action errors).

## Two-factor auth, recovery codes & sessions (lot 2)

Account security lives under your email (top-right) → **Account**.

- [ ] **Enable 2FA**: Account → Enable two-factor → scan the QR with Google Authenticator
      (or enter the secret manually) → enter the 6-digit code → 10 recovery codes are shown
      once. Save them.
- [ ] **Login with 2FA**: sign out, sign in → after the password you are asked for the
      6-digit code; a wrong code is refused, the right one logs you in.
- [ ] **Recovery code**: at the 2FA prompt, enter one of the saved recovery codes instead;
      it works once and is then consumed (reusing it fails).
- [ ] **Regenerate recovery codes**: Account → Regenerate (password required) issues a new
      set and invalidates the old.
- [ ] **Disable 2FA**: Account → Disable (password required); login no longer asks for a code.
- [ ] **Sessions**: Account → Active sessions lists each session with IP, device and last-seen,
      marking the current one. Sign in from another browser → it appears in the list.
- [ ] **Revoke session**: revoke another session → it is signed out (its next request fails).
- [ ] **Sign out others**: "Sign out other sessions" keeps only the current device.

## Backups & text-file versioning (lot 3)

Backups (run on the server, needs `pg_dump`/`pg_restore`):

- [ ] **Backup**: `./scripts/backup.sh ./backups` produces a `opencoperlock-<timestamp>.tar.gz`
      containing `db.dump` and the storage archive.
- [ ] **Restore**: `./scripts/restore.sh <archive>` (type `restore` to confirm) restores the
      database and storage. Verify files still download and decrypt afterwards.
- [ ] **Retention**: `BACKUP_RETENTION=3 ./scripts/backup.sh` keeps only the newest 3 archives.

Versioning (text-like files: txt, md, csv, json, log, yml, …):

- [ ] **Create a version**: upload `notes.txt`, then upload a changed `notes.txt` with the
      same name into the same folder → the Drive still shows one file (not two).
- [ ] **List/restore**: the file's **Versions** button lists prior versions; restoring one
      makes it current and keeps the previous current content as a new version.
- [ ] **Non-text files are not versioned**: re-uploading e.g. an image with the same name
      creates a separate file (no versioning), as before.
- [ ] **Quota**: deleting a versioned file frees the space of the file *and* its versions.

## Upload progress, admin alerts & GDPR self-service (lot 4)

- [ ] **Upload progress**: upload a larger file in the Drive → a progress bar shows the
      percentage (and "Uploading X of N" for multiple files).
- [ ] **Admin alerts**: the Admin page shows an Alerts box when something needs attention —
      e.g. an infected file exists, global storage is ≥90% of the cap, or a user is ≥90% of
      their quota. (Set a small global cap to see the storage warning.)
- [ ] **Export my data**: Account → "Export my data" downloads a JSON file with your
      profile, folders, file metadata, shares, sessions and recent activity.
- [ ] **Delete my account**: Account → "Delete my account" (password required) removes the
      account and all files, then signs you out. The only administrator cannot delete
      themselves.

## Reverse-proxy IP handling & SSRF pinning (lot 5)

Most operators run behind nginx, so client-IP handling and the Remote-Upload SSRF guard
were hardened.

- [ ] **Behind nginx**: with `TRUST_PROXY=1` (and `API_HOST=127.0.0.1`), the IP shown for a
      session (Account → Active sessions) and in the admin audit log is the **real client
      IP**, not the nginx address. The setup wizard sets these automatically when it
      configures nginx.
- [ ] **No proxy**: with `TRUST_PROXY=false` (default), the socket address is used. The app
      must not trust `X-Forwarded-For` from clients in this mode.
- [ ] **SSRF rebinding**: a Remote-Upload of a host that resolves to a private address
      (e.g. a domain pointing at 127.0.0.1) is rejected; a normal public URL still
      downloads. (Verified automatically: the fetcher pins the connection to the validated
      IP.)
- [ ] **Direct API access blocked**: when `API_HOST=127.0.0.1`, the API port is not
      reachable from outside the host — only nginx can reach it.

<!-- New features are appended below as they are built. -->
