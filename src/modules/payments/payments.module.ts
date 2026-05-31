import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeBillingService } from './stripe-billing.service';

@Module({
  imports: [WalletModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeBillingService],
  exports: [PaymentsService, StripeBillingService],
})
export class PaymentsModule {}
