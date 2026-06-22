/**
 * Outgoing webhooks: when a file lands in a user's storage we POST a small JSON event to each of
 * their active webhooks (optionally filtered to one folder). Delivery is best-effort and never
 * blocks the upload; the last status/error is recorded for the UI.
 *
 * The body is signed with HMAC-SHA256 when a secret is set (header X-OpenCoperLock-Signature),
 * and every target URL is re-checked against the SSRF guard at send time so a webhook can't be
 * pointed at localhost or a private address.
 */
import { createHmac } from 'node:crypto';
import type { FileObject, Webhook } from '@prisma/client';
import { assertAllowedUrl } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { toPublicFile } from '../lib/serialize.js';

export type WebhookEvent = 'file.created' | 'file.updated';

const TIMEOUT_MS = 8000;

function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function deliver(hook: Webhook, body: string): Promise<void> {
  try {
    assertAllowedUrl(hook.url); // re-validate at send time (defence in depth)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'OpenCoperLock-Webhook/1',
    };
    if (hook.secret) headers['x-opencoperlock-signature'] = sign(hook.secret, body);
    const res = await fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    await prisma.webhook.update({
      where: { id: hook.id },
      data: { lastStatus: res.status, lastError: res.ok ? null : `HTTP ${res.status}` },
    });
  } catch (err) {
    await prisma.webhook
      .update({ where: { id: hook.id }, data: { lastStatus: 0, lastError: String(err).slice(0, 200) } })
      .catch(() => {});
  }
}

/** Fire matching webhooks for a stored file. Fire-and-forget — callers should not await it. */
export async function dispatchFileEvent(ownerId: string, file: FileObject, event: WebhookEvent): Promise<void> {
  const hooks = await prisma.webhook.findMany({ where: { ownerId, active: true } });
  const matching = hooks.filter((h) => !h.folderId || h.folderId === file.folderId);
  if (matching.length === 0) return;
  const body = JSON.stringify({ event, at: new Date().toISOString(), file: toPublicFile(file) });
  await Promise.all(matching.map((h) => deliver(h, body)));
}

/** Send a one-off test ping to a single webhook (used by the "Test" button). */
export async function sendTestEvent(hook: Webhook): Promise<void> {
  const body = JSON.stringify({ event: 'ping', at: new Date().toISOString(), message: 'OpenCoperLock test event' });
  await deliver(hook, body);
}
