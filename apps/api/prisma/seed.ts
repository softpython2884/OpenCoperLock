/**
 * Idempotent seed: ensures the first admin account and the global Setting row exist.
 * Safe to run on every deploy — it never overwrites an existing admin's password.
 */
import '../src/config/dotenv.js';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the first admin.');
  }

  await prisma.setting.upsert({
    where: { id: 'global' },
    create: { id: 'global', globalStorageCapBytes: BigInt(process.env.GLOBAL_STORAGE_CAP_BYTES ?? '0') },
    update: {},
  });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists — leaving it untouched.`);
    return;
  }

  const quota = process.env.DEFAULT_USER_QUOTA_BYTES;
  const admin = await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      role: 'ADMIN',
      quotaBytes: quota ? BigInt(quota) : null,
    },
  });
  // Every account owns a Fast-Upload folder where Quick-Upload code drops land.
  await prisma.folder.create({
    data: { ownerId: admin.id, parentId: null, name: 'Fast-Upload', isZeroKnowledge: false },
  });
  console.log(`Created admin user: ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
