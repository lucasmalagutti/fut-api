import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import StripeLib = require('stripe');
import { PrismaService } from '../../prisma/prisma.service';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateCardDto } from './dto/create-card.dto';
import { StripePaymentProvider } from './providers/stripe.provider';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private provider = new StripePaymentProvider();
  private stripe = new StripeLib(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder');

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
    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new BadRequestException('Booking cannot be paid in its current status');
    }

    const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
    const feeRate = setting?.feeRate ?? Number(process.env.DEFAULT_FEE_RATE ?? 0.1);
    const fee = booking.totalPrice * feeRate;

    let result: { gatewayRef: string; qrCode?: string; qrCodeUrl?: string };

    try {
      if (dto.method === 'card') {
        if (!dto.cardId) throw new BadRequestException('cardId required for card payment');
        const card = await this.prisma.card.findUnique({ where: { id: dto.cardId } });
        if (!card || card.userId !== user.id) throw new NotFoundException('Card not found');
        result = await this.provider.checkoutCard(booking.id, card.providerToken, booking.totalPrice);
      } else {
        result = await this.provider.checkoutPix(booking.id, booking.totalPrice);
      }
    } catch (err: any) {
      // Erros do Stripe (tipo começa com "Stripe")
      if (err?.type?.startsWith('Stripe')) {
        this.logger.error(`Stripe error on checkout: ${err.message}`, err.code);
        throw new BadRequestException(`Erro no gateway de pagamento: ${err.message}`);
      }
      // Erros HTTP do NestJS (BadRequest, NotFound etc) — repassar diretamente
      if (err?.status && err.status < 500) throw err;
      if (err?.statusCode && err.statusCode < 500) throw err;
      throw new InternalServerErrorException('Erro ao processar pagamento');
    }

    const isPix = dto.method === 'pix';

    const payment = await this.prisma.payment.create({
      data: {
        bookingId: dto.bookingId,
        method: dto.method,
        gatewayRef: result.gatewayRef,
        qrCode: result.qrCode,
        qrCodeUrl: result.qrCodeUrl,
        amount: booking.totalPrice,
        fee,
        status: isPix ? 'pending' : 'paid',
        ...(!isPix && { paidAt: new Date() }),
      },
    });

    // Cartao: confirmar booking e creditar dono imediatamente
    if (!isPix) {
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'confirmed' },
      });
      await this.creditOwner(booking.court.ownerId, booking.id, booking.totalPrice - fee);
    }

    return {
      paymentId: payment.id,
      qrCode: result.qrCode,
      qrCodeUrl: result.qrCodeUrl,
    };
  }

  async getPaymentStatus(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    return { status: payment.status, paidAt: payment.paidAt };
  }

  async confirmPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { include: { court: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'paid') return { message: 'Already confirmed' };

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'paid', paidAt: new Date() },
      }),
      this.prisma.booking.update({
        where: { id: payment.bookingId },
        data: { status: 'confirmed' },
      }),
    ]);

    const ownerCredit = payment.amount - payment.fee;
    await this.creditOwner(payment.booking.court.ownerId, payment.bookingId, ownerCredit);

    return { message: 'Payment confirmed' };
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    let event: ReturnType<typeof this.stripe.webhooks.constructEvent>;

    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.error('Webhook signature invalid', err);
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`Stripe webhook: ${event.type}`);

    if (event.type === 'payment_intent.succeeded') {
      await this.onPaymentSucceeded(event.data.object as Record<string, any>);
    } else if (event.type === 'payment_intent.payment_failed') {
      await this.onPaymentFailed(event.data.object as Record<string, any>);
    }

    return { received: true };
  }

  private async onPaymentSucceeded(intent: Record<string, any>) {
    const payment = await this.prisma.payment.findFirst({
      where: { gatewayRef: intent.id as string },
      include: { booking: { include: { court: true, match: true } } },
    });
    if (!payment) {
      this.logger.warn(`Payment not found for gatewayRef ${intent.id}`);
      return;
    }
    if (payment.status === 'paid') return;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'paid', paidAt: new Date() },
    });

    // Se e pagamento de cota de partida (paymentId referenciado em MatchParticipant)
    const participant = await this.prisma.matchParticipant.findFirst({
      where: { paymentId: payment.id },
    });

    if (participant) {
      // Fluxo coletivo: marcar participante como pago + desbloquear conta se bloqueada
      await this.prisma.matchParticipant.update({
        where: { id: participant.id },
        data: { paymentStatus: 'paid' },
      });
      const user = await this.prisma.user.findUnique({ where: { id: participant.userId } });
      if (user && (user as any).blockedAt) {
        await this.prisma.user.update({
          where: { id: participant.userId },
          data: { blockedAt: null, blockReason: null },
        });
        this.logger.log(`Conta desbloqueada apos pagamento PIX: ${participant.userId}`);
      }
    } else {
      // Fluxo individual (reserva direta): confirmar booking e creditar dono
      await this.prisma.booking.update({
        where: { id: payment.bookingId },
        data: { status: 'confirmed' },
      });
      const ownerCredit = payment.amount - payment.fee;
      await this.creditOwner(payment.booking.court.ownerId, payment.bookingId, ownerCredit);
    }

    this.logger.log(`Payment ${payment.id} confirmed via webhook`);
  }

  private async onPaymentFailed(intent: Record<string, any>) {
    const payment = await this.prisma.payment.findFirst({
      where: { gatewayRef: intent.id as string },
    });
    if (!payment) return;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'failed' },
    });
    this.logger.warn(`Payment ${payment.id} failed`);
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
