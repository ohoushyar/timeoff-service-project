import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  createNotification,
  notificationExists,
} from '../services/notification.service.js';
import type { HolidayEntry } from '../services/policy-engine.js';

const OVERDUE_BUSINESS_HOURS = 48;

@Injectable()
export class ApprovalReminderService {
  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<{ notified: number }> {
    const holidays = await this.prisma.holiday.findMany({ where: { isActive: true } });
    const now = new Date();

    const pendingApprovals = await this.prisma.approval.findMany({
      where: {
        decision: 'PENDING',
        leaveRequest: { status: 'PENDING', submittedAt: { not: null } },
      },
      include: { leaveRequest: true },
    });

    let notified = 0;
    for (const approval of pendingApprovals) {
      const submittedAt = approval.leaveRequest.submittedAt;
      if (!submittedAt) continue;

      const businessHours = countBusinessHours(submittedAt, now, holidays);
      if (businessHours < OVERDUE_BUSINESS_HOURS) continue;

      const dedupeKey = `${approval.id}:overdue`;
      if (await notificationExists(this.prisma, 'APPROVAL_OVERDUE', dedupeKey)) continue;

      await createNotification(this.prisma, {
        type: 'APPROVAL_OVERDUE',
        recipientEmployeeId: approval.approverEmployeeId,
        payload: {
          dedupeKey,
          approvalId: approval.id,
          leaveRequestId: approval.leaveRequestId,
        },
      });
      notified++;
    }

    return { notified };
  }
}

function countBusinessHours(
  start: Date,
  end: Date,
  holidays: HolidayEntry[],
): number {
  if (end <= start) return 0;

  let hours = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    if (isBusinessHour(cursor, holidays)) {
      hours += 1;
    }
    cursor.setHours(cursor.getHours() + 1);
  }
  return hours;
}

function isBusinessHour(date: Date, holidays: HolidayEntry[]): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  if (holidays.some((h) => h.isActive && h.date.toDateString() === date.toDateString())) {
    return false;
  }
  return true;
}

export { countBusinessHours };
