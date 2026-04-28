import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as path from 'path';

const dbUrl = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
const dbPath = path.resolve(dbUrl.replace(/^file:/, ''));
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const hash = (pw: string) => bcrypt.hash(pw, 10);

  await prisma.platformSetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, feeRate: 0.1 },
  });

  const master = await prisma.user.upsert({
    where: { email: 'master@futmatch.app' },
    update: {},
    create: {
      name: 'Master Admin',
      email: 'master@futmatch.app',
      passwordHash: await hash('master123'),
      role: 'master',
      status: 'active',
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: 'dono@futmatch.app' },
    update: {},
    create: {
      name: 'João Dono',
      email: 'dono@futmatch.app',
      passwordHash: await hash('dono1234'),
      role: 'owner',
      status: 'active',
      wallet: { create: { balance: 0 } },
    },
  });

  const player1 = await prisma.user.upsert({
    where: { email: 'jogador1@futmatch.app' },
    update: {},
    create: {
      name: 'Carlos Jogador',
      email: 'jogador1@futmatch.app',
      passwordHash: await hash('jogador123'),
      role: 'player',
      status: 'active',
      wallet: { create: { balance: 50 } },
    },
  });

  await prisma.user.upsert({
    where: { email: 'jogador2@futmatch.app' },
    update: {},
    create: {
      name: 'Ana Jogadora',
      email: 'jogador2@futmatch.app',
      passwordHash: await hash('jogador123'),
      role: 'player',
      status: 'active',
      wallet: { create: { balance: 0 } },
    },
  });

  const court1 = await prisma.court.upsert({
    where: { id: 'court-seed-1' },
    update: {},
    create: {
      id: 'court-seed-1',
      ownerId: owner.id,
      name: 'Arena Society Centro',
      sport: 'society',
      description: 'Campo de society gramado com vestiários e estacionamento.',
      addressLine: 'Rua das Flores, 123',
      city: 'Mogi das Cruzes',
      state: 'SP',
      zip: '08710-000',
      latitude: -23.522,
      longitude: -46.1881,
      amenities: JSON.stringify(['vestiário', 'estacionamento', 'iluminação', 'bebedouro']),
      rules: 'Chuteiras com travas, sem bebidas alcoólicas.',
      status: 'active',
      photos: {
        create: [
          { url: 'https://placehold.co/800x500?text=Arena+Society', position: 0 },
          { url: 'https://placehold.co/800x500?text=Vestiario', position: 1 },
        ],
      },
      schedules: {
        create: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          dayOfWeek: day,
          openTime: '08:00',
          closeTime: day >= 5 ? '20:00' : '22:00',
          slotMinutes: 60,
          basePrice: day >= 5 ? 150 : 120,
        })),
      },
    },
  });

  await prisma.court.upsert({
    where: { id: 'court-seed-2' },
    update: {},
    create: {
      id: 'court-seed-2',
      ownerId: owner.id,
      name: 'Futsal Indoor Mogilar',
      sport: 'futsal',
      description: 'Quadra de futsal coberta com piso emborrachado.',
      addressLine: 'Av. Mogilar, 456',
      city: 'Mogi das Cruzes',
      state: 'SP',
      zip: '08773-000',
      latitude: -23.535,
      longitude: -46.195,
      amenities: JSON.stringify(['cobertura', 'vestiário', 'bebedouro']),
      status: 'active',
      photos: { create: [{ url: 'https://placehold.co/800x500?text=Futsal+Indoor', position: 0 }] },
      schedules: {
        create: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          dayOfWeek: day,
          openTime: '07:00',
          closeTime: day >= 5 ? '22:00' : '23:00',
          slotMinutes: 60,
          basePrice: day >= 5 ? 100 : 80,
        })),
      },
    },
  });

  const booking = await prisma.booking.upsert({
    where: { id: 'booking-seed-1' },
    update: {},
    create: {
      id: 'booking-seed-1',
      courtId: court1.id,
      playerId: player1.id,
      startsAt: new Date('2026-04-20T10:00:00Z'),
      endsAt: new Date('2026-04-20T11:00:00Z'),
      totalPrice: 120,
      status: 'completed',
      payment: {
        create: { method: 'pix', gatewayRef: 'mock_seed_payment', amount: 120, fee: 12, status: 'paid', paidAt: new Date('2026-04-20T10:00:00Z') },
      },
    },
  });

  await prisma.review.upsert({
    where: { bookingId: 'booking-seed-1' },
    update: {},
    create: { bookingId: booking.id, fromId: player1.id, courtId: court1.id, rating: 5, comment: 'Ótima quadra!' },
  });

  await prisma.court.update({ where: { id: court1.id }, data: { ratingAvg: 5, ratingCount: 1 } });

  console.log('✅ Seed concluído!');
  console.log('  master@futmatch.app   / master123');
  console.log('  dono@futmatch.app     / dono1234');
  console.log('  jogador1@futmatch.app / jogador123');
  console.log('  jogador2@futmatch.app / jogador123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
