import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { WalletModule } from '../wallet/wallet.module';
import { BookingScheduler } from './booking.scheduler';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
@Module({
  imports: [NotificationsModule, PaymentsModule, WalletModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingScheduler],
  exports: [BookingsService],
})
export class BookingsModule {}
