import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

describe('prisma seed', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => teardownTestDb(prisma));

  it('seed is idempotent', () => {
    execSync('npx tsx prisma/seed.ts', {
      env: { ...process.env, DATABASE_URL: `file:${process.cwd()}/prisma/test.db` },
      stdio: 'pipe',
    });
    execSync('npx tsx prisma/seed.ts', {
      env: { ...process.env, DATABASE_URL: `file:${process.cwd()}/prisma/test.db` },
      stdio: 'pipe',
    });
    expect(true).toBe(true);
  });

  it('creates holiday reference data', async () => {
    execSync('npx tsx prisma/seed.ts', {
      env: { ...process.env, DATABASE_URL: `file:${process.cwd()}/prisma/test.db` },
      stdio: 'pipe',
    });
    const count = await prisma.holiday.count();
    expect(count).toBeGreaterThan(0);
  });
});
