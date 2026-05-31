import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { UserNotifyService } from './user-notify.service';

@Module({
  imports: [MailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, UserNotifyService],
  exports: [NotificationsService, UserNotifyService],
})
export class NotificationsModule {}
