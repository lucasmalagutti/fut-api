/**
 * Finaliza partida: credita dono (pendente) + libera para saldo disponível.
 * Uso: npm run trigger:match-finalize -- <matchId>
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BookingScheduler } from '../src/modules/bookings/booking.scheduler';

const DEFAULT_MATCH_ID = '0512b1c4-dc8b-4b0b-b368-04344cf5d784';

async function main() {
  const matchId = process.argv[2] ?? DEFAULT_MATCH_ID;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const scheduler = app.get(BookingScheduler);

  const result = await scheduler.triggerMatchFinalize(matchId);
  console.log('\n✅ Partida finalizada:', JSON.stringify(result, null, 2));

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
