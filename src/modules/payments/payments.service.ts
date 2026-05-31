import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserNotifyService } from '../notifications/user-notify.service';
import { WalletLedgerService } from '../wallet/wallet-ledger.service';
import { AttachCardDto } from './dto/attach-card.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateCardDto } from './dto/create-card.dto';
import { ParticipantCheckoutDto } from './dto/participant-checkout.dto';
import { TopUpDto } from './dto/top-up.dto';
import { StripeBillingService } from './stripe-billing.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private stripe: StripeBillingService,
    private ledger: WalletLedgerService,
    private notify: UserNotifyService,
  ) {}

  // ── Cartões (Stripe) ───────────────────────────────────────────────────────

  createSetupIntent(user: User) {
    return this.stripe.createSetupIntent(user);
  }

  attachCard(user: User, dto: AttachCardDto) {
    return this.stripe.attachPaymentMethod(user, dto.paymentMethodId);
  }

  /** Cria PaymentMethod de teste (tok_visa) e salva no perfil do jogador */
  async attachTestCard(user: User) {
    const pm = await this.stripe.attachTestCard(user);
    if (!pm.card) throw new BadRequestException('Cartão de teste inválido');
    const count = await this.prisma.card.count({ where: { userId: user.id } });
    const isDefault = count === 0;
    if (isDefault) {
      await this.prisma.card.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    }
    return this.prisma.card.create({
      data: {
        userId: user.id,
        providerToken: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        holderName: user.name,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        isDefault,
      },
    });
  }

  /** Legado: aceita token já tokenizado pelo cliente */
  async addCard(user: User, dto: CreateCardDto) {
    const count = await this.prisma.card.count({ where: { userId: user.id } });
    return this.prisma.card.create({
      data: { userId: user.id, ...dto, isDefault: count === 0 },
    });
  }

  listCards(userId: string) {
    return this.prisma.card.findMany({ where: { userId }, orderBy: { isDefault: 'desc' } });
  }

  setDefaultCard(userId: string, cardId: string) {
    return this.stripe.setDefaultCard(userId, cardId);
  }

  async deleteCard(userId: string, cardId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.userId !== userId) throw new NotFoundException('Card not found');
    await this.prisma.card.delete({ where: { id: cardId } });
    if (card.isDefault) {
      const next = await this.prisma.card.findFirst({ where: { userId } });
      if (next) await this.prisma.card.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { message: 'Card removed' };
  }

  // ── Recarga carteira (PIX) ─────────────────────────────────────────────────

  async topUpWallet(user: User, dto: TopUpDto) {
    const meta = { purpose: 'wallet_topup' as const, userId: user.id };
    const result = await this.stripe.checkoutPix(meta, dto.amount);
    const payment = await this.prisma.payment.create({
      data: {
        userId: user.id,
        purpose: 'wallet_topup',
        method: 'pix',
        gatewayRef: result.gatewayRef,
        qrCode: result.qrCode,
        qrCodeUrl: result.qrCodeUrl,
        amount: dto.amount,
        fee: 0,
        status: 'pending',
      },
    });
    return { paymentId: payment.id, qrCode: result.qrCode, qrCodeUrl: result.qrCodeUrl };
  }

  // ── Checkout reserva (host / reserva individual) ───────────────────────────

  async checkout(user: User, dto: CheckoutDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: { payments: true, court: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.playerId !== user.id) throw new ForbiddenException();

    const hostPaid = booking.payments.some(
      (p) => p.purpose === 'booking_host' && p.status === 'paid',
    );
    if (hostPaid) throw new BadRequestException('Already paid');

    if (!['open', 'pending', 'confirmed'].includes(booking.status)) {
      throw new BadRequestException('Booking cannot be paid in its current status');
    }

    const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
    const feeRate = setting?.feeRate ?? Number(process.env.DEFAULT_FEE_RATE ?? 0.1);
    const fee = parseFloat((booking.totalPrice * feeRate).toFixed(2));
    const meta = {
      purpose: 'booking_host' as const,
      userId: user.id,
      bookingId: booking.id,
    };

    if (dto.method === 'wallet') {
      await this.ledger.debitForPayment(user.id, booking.totalPrice, booking.id);
      const payment = await this.prisma.payment.create({
        data: {
          userId: user.id,
          bookingId: booking.id,
          purpose: 'booking_host',
          method: 'wallet',
          gatewayRef: `wallet_${Date.now()}`,
          amount: booking.totalPrice,
          fee,
          status: 'paid',
          paidAt: new Date(),
        },
      });
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'confirmed' },
      });
      const ownerCredit = booking.totalPrice - fee;
      await this.ledger.creditOwnerPending(booking.court.ownerId, booking.id, ownerCredit);
      await this.notifyOwnerPendingCredit(booking.court.ownerId, booking, ownerCredit);
      await this.notifyHostBookingPaid(user.id, booking, booking.totalPrice, 'wallet');
      return { paymentId: payment.id };
    }

    let result: { gatewayRef: string; qrCode?: string; qrCodeUrl?: string };
    try {
      if (dto.method === 'card') {
        if (!dto.cardId) throw new BadRequestException('cardId required for card payment');
        const card = await this.prisma.card.findUnique({ where: { id: dto.cardId } });
        if (!card || card.userId !== user.id) throw new NotFoundException('Card not found');
        result = await this.stripe.checkoutCard(meta, card.providerToken, booking.totalPrice);
      } else {
        result = await this.stripe.checkoutPix(meta, booking.totalPrice);
      }
    } catch (err: any) {
      if (err?.type?.startsWith('Stripe')) {
        throw new BadRequestException(`Erro no gateway: ${err.message}`);
      }
      if (err?.status && err.status < 500) throw err;
      if (err?.statusCode && err.statusCode < 500) throw err;
      throw new InternalServerErrorException('Erro ao processar pagamento');
    }

    const isPix = dto.method === 'pix';
    const payment = await this.prisma.payment.create({
      data: {
        userId: user.id,
        bookingId: booking.id,
        purpose: 'booking_host',
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

    if (!isPix) {
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'confirmed' },
      });
      const ownerCredit = booking.totalPrice - fee;
      await this.ledger.creditOwnerPending(booking.court.ownerId, booking.id, ownerCredit);
      await this.notifyOwnerPendingCredit(booking.court.ownerId, booking, ownerCredit);
      await this.notifyHostBookingPaid(user.id, booking, booking.totalPrice, dto.method);
    }

    return { paymentId: payment.id, qrCode: result.qrCode, qrCodeUrl: result.qrCodeUrl };
  }

  // ── Checkout cota de participante ──────────────────────────────────────────

  async checkoutParticipant(user: User, participantId: string, dto: ParticipantCheckoutDto) {
    const participant = await this.prisma.matchParticipant.findUnique({
      where: { id: participantId },
      include: {
        match: { include: { booking: { include: { court: true } } } },
        user: true,
      },
    });
    if (!participant) throw new NotFoundException('Participante não encontrado');
    if (participant.userId !== user.id) throw new ForbiddenException();
    if (!participant.quota || participant.quota <= 0) {
      throw new BadRequestException('Cota ainda não definida');
    }
    if (participant.paymentStatus === 'paid') {
      throw new BadRequestException('Cota já paga');
    }
    if (participant.paymentId) {
      const existing = await this.prisma.payment.findUnique({
        where: { id: participant.paymentId },
      });
      if (existing?.status === 'paid') throw new BadRequestException('Cota já paga');
    }

    const booking = participant.match.booking;
    const amount = participant.quota;
    const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
    const feeRate = setting?.feeRate ?? Number(process.env.DEFAULT_FEE_RATE ?? 0.1);
    const fee = parseFloat((amount * feeRate).toFixed(2));
    const meta = {
      purpose: 'participant_quota' as const,
      userId: user.id,
      bookingId: booking.id,
      participantId: participant.id,
    };

    if (dto.method === 'wallet') {
      await this.ledger.debitForPayment(user.id, amount, booking.id);
      const payment = await this.prisma.payment.create({
        data: {
          userId: user.id,
          bookingId: booking.id,
          purpose: 'participant_quota',
          method: 'wallet',
          gatewayRef: `wallet_${Date.now()}`,
          amount,
          fee,
          status: 'paid',
          paidAt: new Date(),
        },
      });
      await this.prisma.matchParticipant.update({
        where: { id: participant.id },
        data: { paymentStatus: 'paid', paymentId: payment.id },
      });
      await this.clearPixBlock(user.id);
      await this.notifyParticipantPaid(user.id, booking, participant.matchId, amount, 'wallet');
      return { paymentId: payment.id };
    }

    let result: { gatewayRef: string; qrCode?: string; qrCodeUrl?: string };
    if (dto.method === 'card') {
      if (!dto.cardId) throw new BadRequestException('cardId obrigatório');
      const card = await this.prisma.card.findUnique({ where: { id: dto.cardId } });
      if (!card || card.userId !== user.id) throw new NotFoundException('Cartão não encontrado');
      result = await this.stripe.checkoutCard(meta, card.providerToken, amount);
    } else {
      result = await this.stripe.checkoutPix(meta, amount);
    }

    const isPix = dto.method === 'pix';
    const payment = await this.prisma.payment.create({
      data: {
        userId: user.id,
        bookingId: booking.id,
        purpose: 'participant_quota',
        method: dto.method,
        gatewayRef: result.gatewayRef,
        qrCode: result.qrCode,
        qrCodeUrl: result.qrCodeUrl,
        amount,
        fee,
        status: isPix ? 'pending' : 'paid',
        ...(!isPix && { paidAt: new Date() }),
      },
    });

    await this.prisma.matchParticipant.update({
      where: { id: participant.id },
      data: {
        paymentStatus: isPix ? 'unpaid' : 'paid',
        paymentId: payment.id,
      },
    });

    if (!isPix) {
      await this.clearPixBlock(user.id);
      await this.notifyParticipantPaid(user.id, booking, participant.matchId, amount, dto.method);
    }

    return { paymentId: payment.id, qrCode: result.qrCode, qrCodeUrl: result.qrCodeUrl };
  }

  /** Cobrança automática da cota (2h antes) conforme preferência salva na inscrição */
  async chargeParticipantScheduled(participantId: string): Promise<{ ok: boolean; error?: string }> {
    const participant = await this.prisma.matchParticipant.findUnique({
      where: { id: participantId },
      include: {
        match: { include: { booking: { include: { court: true } } } },
        user: true,
      },
    });
    if (!participant) return { ok: false, error: 'Participante não encontrado' };
    if (participant.paymentStatus === 'paid' || participant.paymentStatus === 'checked_in') {
      return { ok: true };
    }
    if (!participant.quota || participant.quota <= 0) {
      return { ok: false, error: 'Cota não definida' };
    }
    if (!participant.preferredPayMethod) {
      await this.prisma.matchParticipant.update({
        where: { id: participantId },
        data: { paymentStatus: 'unpaid' },
      });
      return { ok: false, error: 'Forma de pagamento não informada na inscrição' };
    }

    const user = participant.user;
    const booking = participant.match.booking;
    const amount = participant.quota;
    const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
    const feeRate = setting?.feeRate ?? Number(process.env.DEFAULT_FEE_RATE ?? 0.1);
    const fee = parseFloat((amount * feeRate).toFixed(2));
    const meta = {
      purpose: 'participant_quota' as const,
      userId: user.id,
      bookingId: booking.id,
      participantId: participant.id,
    };

    try {
      if (participant.preferredPayMethod === 'wallet') {
        await this.ledger.debitForPayment(user.id, amount, booking.id);
        const payment = await this.prisma.payment.create({
          data: {
            userId: user.id,
            bookingId: booking.id,
            purpose: 'participant_quota',
            method: 'wallet',
            gatewayRef: `wallet_sched_${Date.now()}`,
            amount,
            fee,
            status: 'paid',
            paidAt: new Date(),
          },
        });
        await this.prisma.matchParticipant.update({
          where: { id: participantId },
          data: { paymentStatus: 'paid', paymentId: payment.id },
        });
        await this.clearPixBlock(user.id);
        this.logger.log(`Cobrança carteira: ${user.email} R$${amount}`);
        await this.notifyParticipantPaid(user.id, booking, participant.matchId, amount, 'wallet');
        return { ok: true };
      }

      if (participant.preferredPayMethod === 'card') {
        const card = participant.preferredCardId
          ? await this.prisma.card.findUnique({ where: { id: participant.preferredCardId } })
          : await this.prisma.card.findFirst({
              where: { userId: user.id, isDefault: true },
            });
        if (!card || card.userId !== user.id) {
          throw new BadRequestException('Cartão de cobrança não encontrado');
        }
        const result = await this.stripe.checkoutCard(meta, card.providerToken, amount);
        const payment = await this.prisma.payment.create({
          data: {
            userId: user.id,
            bookingId: booking.id,
            purpose: 'participant_quota',
            method: 'card',
            gatewayRef: result.gatewayRef,
            amount,
            fee,
            status: 'paid',
            paidAt: new Date(),
          },
        });
        await this.prisma.matchParticipant.update({
          where: { id: participantId },
          data: { paymentStatus: 'paid', paymentId: payment.id },
        });
        await this.clearPixBlock(user.id);
        this.logger.log(`Cobrança cartão: ${user.email} R$${amount}`);
        await this.notifyParticipantPaid(user.id, booking, participant.matchId, amount, 'card');
        return { ok: true };
      }

      return { ok: false, error: 'Método de pagamento inválido' };
    } catch (err: any) {
      await this.prisma.matchParticipant.update({
        where: { id: participantId },
        data: { paymentStatus: 'unpaid' },
      });
      const msg = err?.message ?? 'Falha na cobrança';
      this.logger.warn(`Cobrança falhou ${user.email}: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  getPaymentStatus(paymentId: string) {
    return this.prisma.payment
      .findUnique({ where: { id: paymentId } })
      .then((p) => {
        if (!p) throw new NotFoundException('Payment not found');
        return { status: p.status, paidAt: p.paidAt };
      });
  }

  async confirmPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { include: { court: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'paid') return { message: 'Already confirmed' };

    await this.applyPaymentSuccess(payment.id);
    return { message: 'Payment confirmed' };
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    const stripeClient = this.stripe.getClient();
    let event: ReturnType<typeof stripeClient.webhooks.constructEvent>;

    try {
      event = stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret);
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
    });
    if (!payment || payment.status === 'paid') return;
    await this.applyPaymentSuccess(payment.id);
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
  }

  private async applyPaymentSuccess(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { include: { court: true, match: true } } },
    });
    if (!payment || payment.status === 'paid') return;

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'paid', paidAt: new Date() },
    });

    if (payment.purpose === 'wallet_topup') {
      await this.ledger.creditDeposit(payment.userId, payment.amount, payment.gatewayRef);
      this.logger.log(`Wallet top-up ${payment.id} R$${payment.amount}`);
      await this.notify.depositConfirmed(payment.userId, {
        amount: payment.amount,
        paymentId: payment.id,
      });
      return;
    }

    const participant = payment.bookingId
      ? await this.prisma.matchParticipant.findFirst({
          where: { paymentId: payment.id },
          include: { match: true },
        })
      : null;

    if (payment.purpose === 'participant_quota' && participant) {
      await this.prisma.matchParticipant.update({
        where: { id: participant.id },
        data: { paymentStatus: 'paid' },
      });
      await this.clearPixBlock(participant.userId);
      if (payment.booking) {
        await this.notifyParticipantPaid(
          participant.userId,
          payment.booking,
          participant.matchId,
          payment.amount,
          payment.method,
        );
      }
      return;
    }

    if (payment.booking && payment.purpose === 'booking_host') {
      await this.prisma.booking.update({
        where: { id: payment.bookingId! },
        data: { status: 'confirmed' },
      });
      const ownerCredit = payment.amount - payment.fee;
      await this.ledger.creditOwnerPending(
        payment.booking.court.ownerId,
        payment.bookingId!,
        ownerCredit,
      );
      await this.notifyOwnerPendingCredit(
        payment.booking.court.ownerId,
        payment.booking,
        ownerCredit,
      );
      await this.notifyHostBookingPaid(
        payment.userId,
        payment.booking,
        payment.amount,
        payment.method,
      );
    }
  }

  private async notifyOwnerPendingCredit(
    ownerId: string,
    booking: { id: string; court: { name: string }; startsAt: Date },
    amount: number,
  ) {
    await this.notify.ownerReservationReceived(ownerId, {
      amount,
      bookingId: booking.id,
      courtName: booking.court.name,
      startsAt: booking.startsAt,
    });
  }

  private async notifyHostBookingPaid(
    userId: string,
    booking: { id: string; court: { name: string }; startsAt: Date },
    amount: number,
    method: string,
  ) {
    await this.notify.bookingConfirmed(userId, {
      bookingId: booking.id,
      courtName: booking.court.name,
      startsAt: booking.startsAt,
    });
    await this.notify.paymentCompleted(userId, {
      amount,
      method,
      purpose: 'booking_host',
      bookingId: booking.id,
      courtName: booking.court.name,
    });
  }

  private async notifyParticipantPaid(
    userId: string,
    booking: { id: string; court: { name: string } },
    matchId: string,
    amount: number,
    method: string,
  ) {
    await this.notify.paymentCompleted(userId, {
      amount,
      method,
      purpose: 'participant_quota',
      bookingId: booking.id,
      matchId,
      courtName: booking.court.name,
    });
  }

  private async clearPixBlock(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.blockedAt) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { blockedAt: null, blockReason: null },
      });
    }
  }
}
