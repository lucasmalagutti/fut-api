import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import StripeLib = require('stripe');
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { WalletLedgerService } from './wallet-ledger.service';

function formatBrl(amount: number) {
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private stripe = new StripeLib(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder');

  constructor(
    private prisma: PrismaService,
    private ledger: WalletLedgerService,
    private notifications: NotificationsService,
    private mail: MailService,
  ) {}

  async getWallet(userId: string) {
    const summary = await this.ledger.getSummary(userId);
    const wallet = await this.ledger.ensureWallet(userId);
    const txs = await this.prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { ...summary, txs };
  }

  getTransactions(userId: string) {
    return this.ledger.ensureWallet(userId).then((w) =>
      this.prisma.transaction.findMany({
        where: { walletId: w.id },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  addBankAccount(userId: string, dto: CreateBankAccountDto) {
    return this.prisma.bankAccount.create({ data: { userId, ...dto } });
  }

  listBankAccounts(userId: string) {
    return this.prisma.bankAccount.findMany({ where: { userId } });
  }

  async deleteBankAccount(userId: string, bankAccountId: string) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!account || account.userId !== userId) {
      throw new NotFoundException('Bank account not found');
    }
    await this.prisma.bankAccount.delete({ where: { id: bankAccountId } });
    return { message: 'Bank account removed' };
  }

  async requestPayout(userId: string, bankAccountId: string, amount: number) {
    const summary = await this.ledger.getSummary(userId);
    if (summary.availableBalance < amount) {
      throw new BadRequestException(
        `Saldo disponível insuficiente (disponível: R$${summary.availableBalance.toFixed(2)}). ` +
          'Valores de partidas ainda em andamento ficam em "pendente" até a conclusão.',
      );
    }

    const bankAccount = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!bankAccount || bankAccount.userId !== userId) {
      throw new NotFoundException('Bank account not found');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const wallet = await this.ledger.ensureWallet(userId);
    let gatewayRef = `mock_payout_${Date.now()}`;

    // Mock: Stripe Connect/transfer é opcional; falha não impede o saque local
    let stripeAccountId: string | null = user.stripeAccountId ?? null;
    if (!stripeAccountId) {
      try {
        const account = await this.stripe.accounts.create({
          type: 'express',
          country: 'BR',
          email: user.email,
          capabilities: { transfers: { requested: true } },
          business_type: 'individual',
          metadata: { userId },
        });
        stripeAccountId = account.id;
        await this.prisma.user.update({
          where: { id: userId },
          data: { stripeAccountId },
        });
      } catch (err) {
        this.logger.warn(`Stripe Connect (mock saque): ${(err as Error).message}`);
      }
    }

    if (stripeAccountId) {
      const amountCents = Math.round(amount * 100);
      try {
        const transfer = await this.stripe.transfers.create({
          amount: amountCents,
          currency: 'brl',
          destination: stripeAccountId,
          metadata: { userId, bankAccountId },
        });
        gatewayRef = transfer.id;
      } catch (err) {
        this.logger.warn(`Stripe transfer (mock saque): ${(err as Error).message}`);
      }
    }

    const payout = await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: amount } },
      });
      const created = await tx.payout.create({
        data: { ownerId: userId, bankAccountId, amount, status: 'completed', gatewayRef },
      });
      await tx.transaction.create({
        data: { walletId: wallet.id, type: 'payout', amount: -amount, status: 'completed' },
      });
      return created;
    });

    const message = `Seu saque de ${formatBrl(amount)} foi realizado com sucesso`;
    this.logger.log(`[Mock saque] ${message} → ${user.email}`);

    await this.notifications
      .create(userId, 'payout_completed', {
        payoutId: payout.id,
        amount,
        message,
        mock: true,
      })
      .catch(() => null);

    await this.mail.sendPayoutSuccess(user.email, amount).catch(() => null);

    return { ...payout, message };
  }

  listPayouts(userId: string) {
    return this.prisma.payout.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'desc' } });
  }
}
