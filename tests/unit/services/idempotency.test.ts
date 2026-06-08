import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hashRequestBody, withIdempotency } from '../../../src/services/idempotency.service.js';
import { setupTestDb, teardownTestDb } from '../../helpers/db.js';
import type { PrismaClient } from '@prisma/client';

describe('idempotency.service', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = await setupTestDb();
  });

  afterEach(async () => {
    await teardownTestDb(prisma);
  });

  it('hashRequestBody is stable for key order', () => {
    const a = hashRequestBody({ b: 1, a: 2 });
    const b = hashRequestBody({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('replays identical response for same key and body', async () => {
    let calls = 0;
    const result = await withIdempotency(
      prisma,
      'POST /test',
      'key-1',
      { foo: 'bar' },
      async () => {
        calls++;
        return { statusCode: 201, body: { id: 'x' } };
      },
    );
    expect(result.statusCode).toBe(201);
    expect(calls).toBe(1);

    const replay = await withIdempotency(
      prisma,
      'POST /test',
      'key-1',
      { foo: 'bar' },
      async () => {
        calls++;
        return { statusCode: 201, body: { id: 'y' } };
      },
    );
    expect(replay.body.id).toBe('x');
    expect(calls).toBe(1);
  });

  it('throws IDEMPOTENCY_CONFLICT for same key different body', async () => {
    await withIdempotency(
      prisma,
      'POST /test',
      'key-2',
      { foo: 'bar' },
      async () => ({ statusCode: 201, body: { id: 'x' } }),
    );

    await expect(
      withIdempotency(
        prisma,
        'POST /test',
        'key-2',
        { foo: 'baz' },
        async () => ({ statusCode: 201, body: { id: 'y' } }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
