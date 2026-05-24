import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';

const dbUrl = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
const dbPath = path.resolve(dbUrl.replace(/^file:/, ''));
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter } as any);

const SEED_EMAILS = [
  'master@futmatch.app',
  'dono@futmatch.app',
  'jogador1@futmatch.app',
  'jogador2@futmatch.app',
];

const SEED_COURT_IDS = ['court-seed-1', 'court-seed-2'];
const SEED_BOOKING_ID = 'booking-seed-1';

async function main() {
  // Reserva seed (cascateia payment, review, match, txs)
  await prisma.review.deleteMany({ where: { bookingId: SEED_BOOKING_ID } });
  await prisma.payment.deleteMany({ where: { bookingId: SEED_BOOKING_ID } });
  await prisma.booking.deleteMany({ where: { id: SEED_BOOKING_ID } });

  // Quadras seed (cascateia photos, schedules, blocks)
  await prisma.courtPhoto.deleteMany({ where: { courtId: { in: SEED_COURT_IDS } } });
  await prisma.courtSchedule.deleteMany({ where: { courtId: { in: SEED_COURT_IDS } } });
  await prisma.courtBlock.deleteMany({ where: { courtId: { in: SEED_COURT_IDS } } });
  await prisma.court.deleteMany({ where: { id: { in: SEED_COURT_IDS } } });

  // Usuários seed (cascateia wallet)
  const users = await prisma.user.findMany({ where: { email: { in: SEED_EMAILS } }, select: { id: true } });
  const userIds = users.map((u) => u.id);

  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.log('✅ Registros do seed removidos com sucesso.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
