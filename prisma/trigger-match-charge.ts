/**
 * Dispara manualmente quorum + cobrança (mesmo fluxo do cron 2h antes).
 * Uso: npm run trigger:match-charge -- <matchId>
 *      npm run trigger:match-charge  (última partida open)
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BookingScheduler } from '../src/modules/bookings/booking.scheduler';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const matchIdArg = process.argv[2];

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const prisma = app.get(PrismaService);
  const scheduler = app.get(BookingScheduler);

  let matchId = matchIdArg;
  if (!matchId) {
    const latest = await prisma.match.findFirst({
      where: { booking: { status: 'open' }, closedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, booking: { select: { startsAt: true } } },
    });
    if (!latest) throw new Error('Nenhuma partida open encontrada. Passe o matchId.');
    matchId = latest.id;
    console.log(`Partida (última open): ${matchId} · início ${latest.booking.startsAt.toISOString()}`);
  }

  const result = await scheduler.triggerQuorumCharge(matchId);
  console.log('\n✅ Resultado:', JSON.stringify(result, null, 2));

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
