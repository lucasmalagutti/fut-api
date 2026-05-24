import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import StripeLib = require('stripe');
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private stripe = new StripeLib(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder');

  constructor(private prisma: PrismaService) {}

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: { txs: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    return wallet ?? { balance: 0, txs: [] };
  }

  async getTransactions(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return [];
    return this.prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addBankAccount(userId: string, dto: CreateBankAccountDto) {
    return this.prisma.bankAccount.create({ data: { userId, ...dto } });
  }

  async listBankAccounts(userId: string) {
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
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.balance < amount) throw new BadRequestException('Insufficient balance');

    const bankAccount = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!bankAccount || bankAccount.userId !== userId) {
      throw new NotFoundException('Bank account not found');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    let stripeAccountId: string | null = user.stripeAccountId ?? null;

    if (!stripeAccountId) {
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
      this.logger.log(`Stripe Connect account created: ${stripeAccountId}`);
    }

    const amountCents = Math.round(amount * 100);
    let gatewayRef = `local_payout_${Date.now()}`;

    try {
      const transfer = await this.stripe.transfers.create({
        amount: amountCents,
        currency: 'brl',
        destination: stripeAccountId,
        metadata: { userId, bankAccountId },
      });
      gatewayRef = transfer.id;
      this.logger.log(`Stripe transfer created: ${transfer.id}`);
    } catch (err) {
      this.logger.warn(`Stripe transfer failed (sandbox): ${(err as Error).message}`);
    }

    const payout = await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: amount } },
      });
      const p = await tx.payout.create({
        data: { ownerId: userId, bankAccountId, amount, status: 'completed', gatewayRef },
      });
      await tx.transaction.create({
        data: { walletId: wallet.id, type: 'payout', amount: -amount, status: 'completed' },
      });
      return p;
    });

    return payout;
  }

  async listPayouts(userId: string) {
    return this.prisma.payout.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'desc' } });
  }
}
