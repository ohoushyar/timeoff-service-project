import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';

const TEST_DB = path.join(process.cwd(), 'prisma', 'test.db');

export function getTestDatabaseUrl(): string {
  return `file:${TEST_DB}`;
}

function removeTestDbFiles(): void {
  for (const file of [TEST_DB, `${TEST_DB}-journal`, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(file)) unlinkSync(file);
  }
}

export async function setupTestDb(): Promise<PrismaClient> {
  const url = getTestDatabaseUrl();
  process.env.DATABASE_URL = url;
  removeTestDbFiles();
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  return new PrismaClient({ datasources: { db: { url } } });
}

export async function teardownTestDb(prisma: PrismaClient): Promise<void> {
  await prisma.$disconnect();
  removeTestDbFiles();
}
