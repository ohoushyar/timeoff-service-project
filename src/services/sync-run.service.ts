import type { PrismaClient, SyncRun } from '@prisma/client';
import { AppError } from '../errors/app-error.js';

export async function listSyncRuns(
  prisma: PrismaClient,
  page: number,
  pageSize: number,
): Promise<{ items: SyncRun[]; totalCount: number }> {
  const [items, totalCount] = await Promise.all([
    prisma.syncRun.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { startedAt: 'desc' },
    }),
    prisma.syncRun.count(),
  ]);
  return { items, totalCount };
}

export async function getSyncRun(prisma: PrismaClient, id: string): Promise<SyncRun> {
  const run = await prisma.syncRun.findUnique({ where: { id } });
  if (!run) throw new AppError('NOT_FOUND');
  return run;
}
