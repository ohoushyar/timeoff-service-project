import type { NotificationType, PrismaClient } from '@prisma/client';
import { toJsonValue } from '../lib/json.js';

export interface CreateNotificationInput {
  type: NotificationType;
  recipientEmployeeId: string;
  payload: Record<string, unknown>;
}

export async function createNotification(
  prisma: PrismaClient,
  input: CreateNotificationInput,
): Promise<void> {
  const employee = await prisma.employeeHcmMapping.findUnique({
    where: { id: input.recipientEmployeeId },
    select: { email: true },
  });

  await prisma.notification.create({
    data: {
      type: input.type,
      recipientEmployeeId: input.recipientEmployeeId,
      payload: toJsonValue({
        ...input.payload,
        email: employee?.email,
      }),
    },
  });
}

export async function notifyEmployee(
  prisma: PrismaClient,
  employeeId: string,
  type: NotificationType,
  payload: Record<string, unknown>,
): Promise<void> {
  await createNotification(prisma, {
    type,
    recipientEmployeeId: employeeId,
    payload,
  });
}

export async function notificationExists(
  prisma: PrismaClient,
  type: NotificationType,
  dedupeKey: string,
): Promise<boolean> {
  const recent = await prisma.notification.findMany({
    where: { type },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return recent.some((n) => (n.payload as Record<string, unknown>).dedupeKey === dedupeKey);
}
