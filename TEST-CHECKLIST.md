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

<!-- New features are appended below as they are built. -->
