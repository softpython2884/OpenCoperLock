import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

/**
 * Validate `data` against a zod schema. On success returns the parsed value; on
 * failure sends a 400 with field details and returns `undefined`, so handlers can:
 *
 *   const body = parseOr400(reply, schema, req.body);
 *   if (!body) return;
 */
export function parseOr400<T extends z.ZodTypeAny>(
  reply: FastifyReply,
  schema: T,
  data: unknown,
): z.infer<T> | undefined {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.code(400).send({
      error: 'Validation failed',
      code: 'VALIDATION',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return undefined;
  }
  return result.data;
}
