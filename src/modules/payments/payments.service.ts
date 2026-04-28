import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateCardDto } from './dto/create-card.dto';
import { MockPaymentProvider } from './providers/mock.provider';

@Injectable()
export class PaymentsService {
  private provider = new MockPaymentProvider();

  constructor(private prisma: PrismaService) {}

  async addCard(user: User, dto: CreateCardDto) {
    return this.prisma.card.create({ data: { userId: user.id, ...dto } });
  }

  async listCards(userId: string) {
    return this.prisma.card.findMany({ where: { userId } });
  }

  async deleteCard(userId: string, cardId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.userId !== userId) throw new NotFoundException('Card not found');
    await this.prisma.card.delete({ where: { id: cardId } });
    return { message: 'Card removed' };
  }

  async checkout(user: User, dto: CheckoutDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: { payment: true, court: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.playerId !== user.id) throw new ForbiddenException();
    if (booking.payment) throw new BadRequestException('Already paid');

    const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
    const feeRate = setting?.feeRate ?? 0.1;
    const fee = booking.totalPrice * feeRate;

    let result: { gatewayRef: string; qrCode?: string };

    if (dto.method === 'card') {
      if (!dto.cardId) throw new BadRequestException('cardId required for card payment');
      const card = await this.prisma.card.findUnique({ where: { id: dto.cardId } });
      if (!card || card.userId !== user.id) throw new NotFoundException('Card not found');
      result = await this.provider.checkoutCard(booking.id, card.providerToken, booking.totalPrice);
    } else {
      result = await this.provider.checkoutPix(booking.id, booking.totalPrice);
    }

    const payment = await this.prisma.payment.create({
      data: {
        bookingId: dto.bookingId,
        method: dto.method,
        gatewayRef: result.gatewayRef,
        qrCode: result.qrCode,
        amount: booking.totalPrice,
        fee,
        status: dto.method === 'card' ? 'paid' : 'pending',
        ...(dto.method === 'card' && { paidAt: new Date() }),
      },
    });

    if (dto.method === 'card') {
      await this.creditOwner(booking.court.ownerId, booking.id, booking.totalPrice - fee);
    }

    return { paymentId: payment.id, qrCode: result.qrCode };
  }

  async confirmPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { include: { court: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'paid') return { message: 'Already confirmed' };

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'paid', paidAt: new Date() },
    });

    const ownerCredit = payment.amount - payment.fee;
    await this.creditOwner(payment.booking.court.ownerId, payment.bookingId, ownerCredit);

    return { message: 'Payment confirmed' };
  }

  private async creditOwner(ownerId: string, bookingId: string, amount: number) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId: ownerId },
      update: { balance: { increment: amount } },
      create: { userId: ownerId, balance: amount },
    });

    await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'booking_charge',
        bookingId,
        amount,
        status: 'completed',
      },
    });
  }
}
