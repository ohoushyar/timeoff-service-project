import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const holidays = [
    { name: 'New Year', date: new Date('2026-01-01'), location: null, isActive: true },
    { name: 'Independence Day', date: new Date('2026-07-04'), location: 'US-NY', isActive: true },
  ];

  for (const h of holidays) {
    const existing = await prisma.holiday.findFirst({
      where: { name: h.name, date: h.date },
    });
    if (!existing) {
      await prisma.holiday.create({ data: h });
    }
  }

  console.log('Seed completed');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
