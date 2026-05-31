import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WalletLedgerService {
  constructor(private prisma: PrismaService) {}

  async ensureWallet(userId: string) {
    return this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId, balance: 0, pendingBalance: 0 },
    });
  }

  async getSummary(userId: string) {
    const wallet = await this.ensureWallet(userId);
    return {
      balance: wallet.balance,
      pendingBalance: wallet.pendingBalance,
      availableBalance: wallet.balance,
    };
  }

  /** Recarga PIX confirmada — credita saldo do jogador */
  async creditDeposit(userId: string, amount: number, gatewayRef: string) {
    const wallet = await this.ensureWallet(userId);
    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'deposit',
          amount,
          status: 'completed',
          gatewayRef,
        },
      }),
    ]);
  }

  /** Pagamento com saldo da carteira */
  async debitForPayment(userId: string, amount: number, bookingId: string) {
    const wallet = await this.ensureWallet(userId);
    if (wallet.balance < amount) {
      throw new BadRequestException('Saldo insuficiente na carteira');
    }
    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: amount } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'booking_charge',
          bookingId,
          amount: -amount,
          status: 'completed',
        },
      }),
    ]);
  }

  /** Dono recebe na partida — fica pendente até conclusão */
  async creditOwnerPending(ownerId: string, bookingId: string, amount: number) {
    const wallet = await this.ensureWallet(ownerId);
    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { pendingBalance: { increment: amount } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'booking_charge',
          bookingId,
          amount,
          status: 'pending',
        },
      }),
    ]);
  }

  /** Após partida concluída — libera saque */
  async releaseOwnerFunds(ownerId: string, bookingId: string) {
    const wallet = await this.ensureWallet(ownerId);
    const pendingTxs = await this.prisma.transaction.findMany({
      where: { walletId: wallet.id, bookingId, type: 'booking_charge', status: 'pending' },
    });
    const total = pendingTxs.reduce((s, t) => s + t.amount, 0);
    if (total <= 0) return;

    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: total }, pendingBalance: { decrement: total } },
      }),
      this.prisma.transaction.updateMany({
        where: { id: { in: pendingTxs.map((t) => t.id) } },
        data: { status: 'completed' },
      }),
    ]);
  }
}
