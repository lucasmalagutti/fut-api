/**
 * Cria 10 jogadores de simulação e vincula à partida informada.
 * Uso: npm run seed:match-players -- <matchId>
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as path from 'path';

const MATCH_ID = process.argv[2] ?? '7ade8db9-52e8-4612-ad4a-52cd7e097e4f';
const PLAYER_COUNT = 10;
const PASSWORD = 'sim123456';

const dbUrl = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
const dbPath = path.resolve(dbUrl.replace(/^file:/, ''));
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const match = await prisma.match.findUnique({
    where: { id: MATCH_ID },
    include: {
      booking: true,
      participants: true,
    },
  });

  if (!match) {
    throw new Error(`Partida não encontrada: ${MATCH_ID}`);
  }

  const hash = await bcrypt.hash(PASSWORD, 10);
  const existingUserIds = new Set(match.participants.map((p) => p.userId));
  const hostIsParticipant = existingUserIds.has(match.hostId);

  const neededSlots = PLAYER_COUNT;
  const currentSlots = match.participants
    .filter((p) => p.paymentStatus !== 'cancelled')
    .reduce((s, p) => s + p.slots, 0);
  const slotsToAdd = neededSlots;
  const minMax = Math.max(match.maxPlayers, currentSlots + slotsToAdd + (hostIsParticipant ? 0 : 1));

  if (minMax > match.maxPlayers) {
    await prisma.match.update({
      where: { id: MATCH_ID },
      data: { maxPlayers: minMax },
    });
    console.log(`maxPlayers ajustado para ${minMax}`);
  }

  if (!['open', 'pending'].includes(match.booking.status)) {
    await prisma.booking.update({
      where: { id: match.bookingId },
      data: { status: 'open' },
    });
    console.log('booking.status → open');
  }

  const created: { email: string; id: string }[] = [];

  for (let i = 1; i <= PLAYER_COUNT; i++) {
    const email = `sim.jogador${String(i).padStart(2, '0')}@futmatch.test`;
    const name = `Jogador Sim ${String(i).padStart(2, '0')}`;

    const user = await prisma.user.upsert({
      where: { email },
      update: { status: 'active' },
      create: {
        name,
        email,
        passwordHash: hash,
        role: 'player',
        status: 'active',
        wallet: { create: { balance: 200, pendingBalance: 0 } },
      },
    });

    await prisma.wallet.upsert({
      where: { userId: user.id },
      update: { balance: 200 },
      create: { userId: user.id, balance: 200, pendingBalance: 0 },
    });

    if (existingUserIds.has(user.id)) {
      await prisma.matchParticipant.updateMany({
        where: { matchId: MATCH_ID, userId: user.id },
        data: { preferredPayMethod: 'wallet', preferredCardId: null },
      });
      console.log(`  já na partida (carteira): ${email}`);
      created.push({ email, id: user.id });
      continue;
    }

    await prisma.matchParticipant.create({
      data: {
        matchId: MATCH_ID,
        userId: user.id,
        slots: 1,
        paymentStatus: 'joined',
        preferredPayMethod: 'wallet',
      },
    });

    existingUserIds.add(user.id);
    created.push({ email, id: user.id });
    console.log(`  + participante: ${email}`);
  }

  const total = await prisma.matchParticipant.count({
    where: { matchId: MATCH_ID, paymentStatus: { not: 'cancelled' } },
  });

  const refreshed = await prisma.match.findUnique({
    where: { id: MATCH_ID },
    include: { booking: { select: { totalPrice: true, status: true, startsAt: true } } },
  });

  console.log('\n✅ Concluído');
  console.log(`   Partida: ${MATCH_ID}`);
  console.log(`   Participantes ativos: ${total} (host + simulados)`);
  console.log(`   minPlayers: ${refreshed?.minPlayers} | maxPlayers: ${refreshed?.maxPlayers}`);
  console.log(`   Reserva: R$ ${refreshed?.booking.totalPrice} | status ${refreshed?.booking.status}`);
  console.log(`   Início: ${refreshed?.booking.startsAt.toISOString()}`);
  console.log(`   Senha de todos: ${PASSWORD}`);
  console.log('\n   Logins (simulação de pagamento):');
  created.forEach((p) => console.log(`     ${p.email}`));
  console.log('\n   Cobrança automática: cron confirma ~2h antes do horário da reserva (quorum).');
  console.log('   Cobrança manual: entre com cada jogador e pague a cota na tela da partida.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
