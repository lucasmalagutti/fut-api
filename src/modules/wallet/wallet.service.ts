import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export class CreateBankAccountDto {
  holderName!: string;
  document!: string;
  bank!: string;
  agency!: string;
  accountNumber!: string;
  accountType!: string;
  pixKey?: string;
}

@Injectable()
export class WalletService {
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

  async requestPayout(userId: string, bankAccountId: string, amount: number) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.balance < amount) throw new BadRequestException('Insufficient balance');

    const bankAccount = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!bankAccount || bankAccount.userId !== userId) {
      throw new NotFoundException('Bank account not found');
    }

    const payout = await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: amount } },
      });
      const p = await tx.payout.create({
        data: { ownerId: userId, bankAccountId, amount, status: 'completed', gatewayRef: `mock_payout_${Date.now()}` },
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
