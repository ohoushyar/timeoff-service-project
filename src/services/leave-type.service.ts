import type { PrismaClient } from '@prisma/client';

export async function listLeaveTypes(prisma: PrismaClient, page: number, pageSize: number) {
  const where = { isActive: true };
  const [items, totalCount] = await Promise.all([
    prisma.leaveType.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: 'asc' },
    }),
    prisma.leaveType.count({ where }),
  ]);
  return { items, totalCount };
}
