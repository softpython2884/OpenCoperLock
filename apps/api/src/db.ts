import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client. Using a module-level singleton avoids exhausting
 * the connection pool during dev hot-reloads.
 */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * BigInt is used for byte counts in the schema. JSON.stringify cannot serialise
 * BigInt, so we register a serialiser that renders them as numbers (safe up to
 * 2^53 bytes ≈ 8 PiB, far beyond any realistic single deployment).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function toJSON() {
  return Number(this);
};
