import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StripePaymentProvider } from '../payments/providers/stripe.provider';

@Injectable()
export class BookingScheduler {
  private readonly logger = new Logger(BookingScheduler.name);
  private readonly provider = new StripePaymentProvider();

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private notifications: NotificationsService,
  ) {}

  // ── Verificacao de quorum a cada minuto ───────────────────────────────────
  // Busca bookings open cuja partida inicia entre agora e 2h10min (janela de 10min)
  @Cron('* * * * *')
  async checkQuorum() {
    const now = new Date();
    const twoHoursAhead = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const twoHoursTenAhead = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 10 * 60 * 1000);

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'open',
        startsAt: { gte: twoHoursAhead, lte: twoHoursTenAhead },
        match: { closedAt: null },
      },
      include: {
        court: true,
        match: {
          include: {
            participants: { where: { paymentStatus: { not: 'cancelled' } } },
          },
        },
        player: true,
      },
    });

    for (const booking of bookings) {
      if (!booking.match) continue;
      await this.processQuorum(booking as any);
    }
  }

  private async processQuorum(booking: any) {
    const match = booking.match;
    const activeParticipants = match.participants.filter((p: any) => p.paymentStatus !== 'cancelled');
    const totalSlots = activeParticipants.reduce((acc: number, p: any) => acc + p.slots, 0);

    this.logger.log(`Quorum check: match ${match.id} — ${totalSlots}/${match.minPlayers} jogadores`);

    // Fechar inscricoes independente do resultado
    await this.prisma.match.update({
      where: { id: match.id },
      data: { closedAt: new Date() },
    });

    if (totalSlots < match.minPlayers) {
      // Quorum insuficiente — cancelar partida
      await this.cancelDueToQuorum(booking, match, activeParticipants);
    } else {
      // Quorum atingido — confirmar e cobrar
      await this.confirmAndCharge(booking, match, activeParticipants, totalSlots);
    }
  }

  private async cancelDueToQuorum(booking: any, match: any, participants: any[]) {
    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'cancelled', cancellationReason: 'Quorum insuficiente' },
      }),
    ]);

    this.logger.warn(`Match ${match.id} cancelada por quorum insuficiente`);

    // Notificar todos os participantes
    for (const p of participants) {
      await this.notifications
        .create(p.userId, 'match_cancelled_quorum', {
          matchId: match.id,
          courtName: booking.court.name,
          startsAt: booking.startsAt,
        })
        .catch(() => null);
    }
  }

  private async confirmAndCharge(booking: any, match: any, participants: any[], totalSlots: number) {
    // Calcular cota por slot
    const quota = parseFloat((booking.totalPrice / totalSlots).toFixed(2));

    // Atualizar quotas de cada participante
    await this.prisma.match.update({
      where: { id: match.id },
      data: { confirmedAt: new Date() },
    });

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'confirmed' },
    });

    for (const p of participants) {
      const participantQuota = parseFloat((quota * p.slots).toFixed(2));
      await this.prisma.matchParticipant.update({
        where: { id: p.id },
        data: { quota: participantQuota },
      });
    }

    this.logger.log(`Match ${match.id} confirmada — ${totalSlots} slots, cota R$${quota}`);

    // Cobrar cada participante
    for (const p of participants) {
      await this.chargeParticipant(p, booking, match, quota).catch((err) => {
        this.logger.error(`Falha ao cobrar participante ${p.userId}: ${err.message}`);
      });
    }
  }

  // Cobrar participante: cartao automatico ou PIX com prazo
  private async chargeParticipant(participant: any, booking: any, match: any, quotaPerSlot: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: participant.userId },
      include: { cards: { where: { isDefault: true }, take: 1 } },
    });
    if (!user) return;

    const amount = parseFloat((quotaPerSlot * participant.slots).toFixed(2));

    // Verificar se ja tem cartao padrao → cobrar automaticamente
    const defaultCard = (user as any).cards?.[0];

    if (defaultCard) {
      try {
        const result = await this.provider.checkoutCard(
          `${booking.id}_${participant.userId}`,
          defaultCard.providerToken,
          amount,
        );

        const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
        const feeRate = setting?.feeRate ?? Number(process.env.DEFAULT_FEE_RATE ?? 0.1);
        const fee = parseFloat((amount * feeRate).toFixed(2));

        await this.prisma.$transaction(async (tx) => {
          const payment = await tx.payment.create({
            data: {
              bookingId: booking.id,
              method: 'card',
              gatewayRef: result.gatewayRef,
              amount,
              fee,
              status: 'paid',
              paidAt: new Date(),
            },
          });
          await tx.matchParticipant.update({
            where: { id: participant.id },
            data: { paymentStatus: 'paid', paymentId: payment.id },
          });
        });

        this.logger.log(`Cartao cobrado: participante ${participant.userId} R$${amount}`);

        // Notificar participante
        await this.notifications
          .create(participant.userId, 'payment_charged', {
            matchId: match.id,
            amount,
            method: 'card',
          })
          .catch(() => null);
      } catch (err: any) {
        this.logger.warn(`Falha cartao ${participant.userId}: ${err.message} — enviando PIX`);
        await this.sendPixCharge(participant, booking, match, amount);
      }
    } else {
      // Sem cartao → enviar PIX
      await this.sendPixCharge(participant, booking, match, amount);
    }
  }

  private async sendPixCharge(participant: any, booking: any, match: any, amount: number) {
    try {
      const result = await this.provider.checkoutPix(
        `${booking.id}_${participant.userId}`,
        amount,
      );

      const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
      const feeRate = setting?.feeRate ?? Number(process.env.DEFAULT_FEE_RATE ?? 0.1);
      const fee = parseFloat((amount * feeRate).toFixed(2));

      const payment = await this.prisma.payment.create({
        data: {
          bookingId: booking.id,
          method: 'pix',
          gatewayRef: result.gatewayRef,
          qrCode: result.qrCode,
          qrCodeUrl: result.qrCodeUrl,
          amount,
          fee,
          status: 'pending',
        },
      });

      await this.prisma.matchParticipant.update({
        where: { id: participant.id },
        data: { paymentStatus: 'unpaid', paymentId: payment.id },
      });

      // Notificar com PIX
      await this.notifications
        .create(participant.userId, 'pix_payment_required', {
          matchId: match.id,
          paymentId: payment.id,
          amount,
          qrCode: result.qrCode,
          deadline: new Date(booking.startsAt.getTime() - 60 * 60 * 1000).toISOString(),
        })
        .catch(() => null);

      this.logger.log(`PIX enviado: participante ${participant.userId} R$${amount}`);
    } catch (err: any) {
      this.logger.error(`Erro ao criar PIX para ${participant.userId}: ${err.message}`);
    }
  }

  // ── Verificar PIX nao pago 1h antes do inicio ─────────────────────────────
  @Cron('* * * * *')
  async checkPixDeadline() {
    const now = new Date();
    const oneHourAhead = new Date(now.getTime() + 60 * 60 * 1000);
    const oneHourTenAhead = new Date(now.getTime() + 60 * 60 * 1000 + 10 * 60 * 1000);

    // Buscar participantes com PIX pendente em partidas que iniciam em ~1h
    const participants = await this.prisma.matchParticipant.findMany({
      where: {
        paymentStatus: 'unpaid',
        match: {
          booking: {
            startsAt: { gte: oneHourAhead, lte: oneHourTenAhead },
          },
        },
      },
      include: {
        user: true,
        match: { include: { booking: { include: { court: true } } } },
      },
    });

    for (const p of participants) {
      await this.blockUserForUnpaidPix(p).catch((err) =>
        this.logger.error(`Erro ao bloquear ${p.userId}: ${err.message}`),
      );
    }
  }

  private async blockUserForUnpaidPix(participant: any) {
    await this.prisma.user.update({
      where: { id: participant.userId },
      data: {
        blockedAt: new Date(),
        blockReason: `PIX nao pago — partida ${participant.matchId}`,
      },
    });

    await this.prisma.matchParticipant.update({
      where: { id: participant.id },
      data: { paymentStatus: 'cancelled' },
    });

    await this.notifications
      .create(participant.userId, 'account_blocked_pix', {
        matchId: participant.matchId,
        reason: 'PIX nao pago dentro do prazo',
      })
      .catch(() => null);

    this.logger.warn(`Conta bloqueada por PIX nao pago: ${participant.userId}`);
  }

  // ── Creditar dono no inicio da partida ────────────────────────────────────
  @Cron('* * * * *')
  async creditOwnerAtStart() {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'confirmed',
        ownerCreditedAt: null,
        startsAt: { gte: fiveMinutesAgo, lte: now },
      },
      include: {
        court: true,
        match: {
          include: {
            participants: { where: { paymentStatus: { in: ['paid', 'checked_in'] } } },
          },
        },
      },
    });

    for (const booking of bookings) {
      await this.creditOwner(booking as any).catch((err) =>
        this.logger.error(`Erro ao creditar dono booking ${booking.id}: ${err.message}`),
      );
    }
  }

  private async creditOwner(booking: any) {
    const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
    const feeRate = setting?.feeRate ?? Number(process.env.DEFAULT_FEE_RATE ?? 0.1);

    const totalPaid = booking.match?.participants?.reduce((acc: number, p: any) => acc + (p.quota ?? 0), 0) ?? 0;
    const ownerAmount = parseFloat((totalPaid * (1 - feeRate)).toFixed(2));

    const wallet = await this.prisma.wallet.upsert({
      where: { userId: booking.court.ownerId },
      update: { balance: { increment: ownerAmount } },
      create: { userId: booking.court.ownerId, balance: ownerAmount },
    });

    await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'booking_charge',
          bookingId: booking.id,
          amount: ownerAmount,
          status: 'completed',
        },
      }),
      this.prisma.booking.update({
        where: { id: booking.id },
        data: { ownerCreditedAt: new Date() },
      }),
    ]);

    this.logger.log(`Dono creditado: booking ${booking.id} R$${ownerAmount}`);
  }

  // ── Liberar saque apos termino da partida ─────────────────────────────────
  @Cron('* * * * *')
  async releasePayout() {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'confirmed',
        ownerCreditedAt: { not: null },
        payoutReleasedAt: null,
        endsAt: { gte: fiveMinutesAgo, lte: now },
      },
    });

    for (const booking of bookings) {
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'completed', payoutReleasedAt: new Date() },
      });
      this.logger.log(`Saque liberado para booking ${booking.id}`);
    }
  }

  // ── Completar bookings expirados (fallback) ───────────────────────────────
  @Cron('*/5 * * * *')
  async completeExpiredBookings() {
    await this.prisma.booking.updateMany({
      where: {
        status: 'confirmed',
        endsAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
        payoutReleasedAt: null,
      },
      data: { status: 'completed', payoutReleasedAt: new Date() },
    });
  }
}
