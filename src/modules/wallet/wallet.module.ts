import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [NotificationsModule, MailModule],
  controllers: [WalletController],
  providers: [WalletService, WalletLedgerService],
  exports: [WalletService, WalletLedgerService],
})
export class WalletModule {}
