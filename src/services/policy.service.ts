import type { PrismaClient } from '@prisma/client';

export async function listPolicies(prisma: PrismaClient, page: number, pageSize: number) {
  const where = { isActive: true };
  const [items, totalCount] = await Promise.all([
    prisma.leavePolicy.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: 'asc' },
    }),
    prisma.leavePolicy.count({ where }),
  ]);
  return { items, totalCount };
}
