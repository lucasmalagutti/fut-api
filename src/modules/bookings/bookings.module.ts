import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingScheduler } from './booking.scheduler';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule, NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingScheduler],
  exports: [BookingsService],
})
export class BookingsModule {}
