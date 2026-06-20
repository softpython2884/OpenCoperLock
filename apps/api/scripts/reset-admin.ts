/**
 * Admin account recovery. Reset (or create) an administrator's password directly in the
 * database — for when you've locked yourself out. Driven by env vars so the shell wrapper
 * (scripts/reset-admin.sh) can collect the password securely:
 *
 *   RESET_LIST=1                       -> just list existing admin accounts
 *   RESET_EMAIL=, RESET_PASSWORD=      -> reset that account's password (creates it if new)
 *   RESET_CLEAR_2FA=1                  -> also disable 2FA + clear recovery codes
 *
 * Run via:  pnpm --filter @opencoperlock/api exec tsx scripts/reset-admin.ts
 */
import '../src/config/dotenv.js';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/services/password.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.RESET_LIST === '1') {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { email: true, disabled: true, totpEnabled: true },
      orderBy: { createdAt: 'asc' },
    });
    if (admins.length === 0) {
      console.log('  (no administrator accounts exist yet)');
    } else {
      for (const a of admins) {
        const flags = [a.disabled ? 'disabled' : null, a.totpEnabled ? '2FA on' : null]
          .filter(Boolean)
          .join(', ');
        console.log(`  - ${a.email}${flags ? ` (${flags})` : ''}`);
      }
    }
    return;
  }

  const email = process.env.RESET_EMAIL?.trim().toLowerCase();
  const password = process.env.RESET_PASSWORD;
  const clear2fa = process.env.RESET_CLEAR_2FA === '1';
  if (!email || !password) throw new Error('RESET_EMAIL and RESET_PASSWORD are required.');
  if (password.length < 12) throw new Error('Password must be at least 12 characters.');

  const passwordHash = await hashPassword(password);
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: {
        passwordHash,
        role: 'ADMIN',
        disabled: false,
        ...(clear2fa ? { totpEnabled: false, totpSecret: null } : {}),
      },
    });
    // Invalidate existing sessions so any attacker-held session is dropped too.
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    if (clear2fa) await prisma.recoveryCode.deleteMany({ where: { userId: existing.id } });
    console.log(
      `Reset password for admin '${email}'${clear2fa ? ' and disabled 2FA' : ''}; sessions cleared.`,
    );
  } else {
    const quota = process.env.DEFAULT_USER_QUOTA_BYTES;
    await prisma.user.create({
      data: { email, passwordHash, role: 'ADMIN', quotaBytes: quota ? BigInt(quota) : null },
    });
    console.log(`Created new admin '${email}'.`);
  }
}

main()
  .catch((err) => {
    console.error('ERROR:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
