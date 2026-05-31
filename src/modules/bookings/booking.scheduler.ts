import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserNotifyService } from '../notifications/user-notify.service';
import { PaymentsService } from '../payments/payments.service';
import { WalletLedgerService } from '../wallet/wallet-ledger.service';

@Injectable()
export class BookingScheduler {
  private readonly logger = new Logger(BookingScheduler.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private notify: UserNotifyService,
    private payments: PaymentsService,
    private ledger: WalletLedgerService,
  ) {}

  /** Dev/teste: força quorum + cobrança para uma partida (ignora janela de 2h) */
  async triggerQuorumCharge(matchId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { match: { id: matchId } },
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

    if (!booking?.match) {
      throw new Error(`Partida/reserva não encontrada: ${matchId}`);
    }

    if (booking.match.confirmedAt) {
      return {
        matchId,
        skipped: true,
        reason: 'Partida já confirmada — recobrando apenas participantes não pagos',
        charges: await this.rechargeUnpaidParticipants(booking.match.id),
      };
    }

    if (booking.status !== 'open') {
      throw new Error(`Reserva com status "${booking.status}" — esperado "open" para primeiro disparo`);
    }

    await this.processQuorum(booking as any);

    const updated = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        booking: true,
        participants: {
          where: { paymentStatus: { not: 'cancelled' } },
          include: { user: { select: { email: true } } },
        },
      },
    });

    return {
      matchId,
      bookingStatus: updated?.booking.status,
      confirmedAt: updated?.confirmedAt,
      participants: updated?.participants.map((p) => ({
        email: p.user.email,
        quota: p.quota,
        paymentStatus: p.paymentStatus,
        preferredPayMethod: p.preferredPayMethod,
      })),
    };
  }

  private async rechargeUnpaidParticipants(matchId: string) {
    const unpaid = await this.prisma.matchParticipant.findMany({
      where: { matchId, paymentStatus: { in: ['joined', 'unpaid'] } },
    });
    const results: { participantId: string; userId: string; ok: boolean; error?: string }[] = [];
    for (const p of unpaid) {
      const r = await this.payments.chargeParticipantScheduled(p.id);
      results.push({ participantId: p.id, userId: p.userId, ...r });
    }
    return results;
  }

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

    await this.notify
      .bookingConfirmed(booking.playerId, {
        bookingId: booking.id,
        courtName: booking.court.name,
        startsAt: booking.startsAt,
      })
      .catch(() => null);

    const toCharge = await this.prisma.matchParticipant.findMany({
      where: { matchId: match.id, paymentStatus: { not: 'cancelled' } },
    });

    for (const p of toCharge) {
      const result = await this.payments.chargeParticipantScheduled(p.id);
      if (!result.ok) {
        await this.notifications
          .create(p.userId, 'payment_charge_failed', {
            matchId: match.id,
            amount: quota * p.slots,
            message: result.error ?? 'Não foi possível cobrar sua cota. Pague manualmente na partida.',
          })
          .catch(() => null);
        this.logger.error(`Falha ao cobrar participante ${p.userId}: ${result.error}`);
      }
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

  /** Dev/teste: credita dono (pendente) e libera saldo disponível ao finalizar partida */
  async triggerMatchFinalize(matchId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { match: { id: matchId } },
      include: {
        court: { include: { owner: { select: { id: true, email: true, name: true } } } },
        match: {
          include: {
            participants: { where: { paymentStatus: { in: ['paid', 'checked_in'] } } },
          },
        },
      },
    });

    if (!booking?.match) {
      throw new Error(`Partida/reserva não encontrada: ${matchId}`);
    }
    if (booking.status !== 'confirmed' && booking.status !== 'completed') {
      throw new Error(`Reserva deve estar confirmed (atual: ${booking.status})`);
    }

    const steps: string[] = [];

    if (!booking.ownerCreditedAt) {
      await this.creditOwner(booking as any);
      steps.push('owner_credited_pending');
    } else {
      steps.push('owner_already_credited');
    }

    const refreshed = await this.prisma.booking.findUnique({
      where: { id: booking.id },
      include: { court: true },
    });
    if (!refreshed) throw new Error('Booking not found after credit');

    if (!refreshed.payoutReleasedAt) {
      await this.releaseAndNotifyOwner(refreshed);
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'completed', payoutReleasedAt: new Date() },
      });
      steps.push('payout_released_to_balance');
    } else {
      steps.push('payout_already_released');
    }

    const ownerWallet = await this.prisma.wallet.findUnique({
      where: { userId: refreshed.court.ownerId },
    });

    const totalPaid =
      booking.match.participants.reduce((acc, p) => acc + (p.quota ?? 0), 0) ?? 0;
    const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
    const feeRate = setting?.feeRate ?? Number(process.env.DEFAULT_FEE_RATE ?? 0.1);
    const ownerNet = parseFloat((totalPaid * (1 - feeRate)).toFixed(2));

    return {
      matchId,
      bookingId: booking.id,
      bookingStatus: 'completed',
      steps,
      totalCollected: totalPaid,
      platformFeeRate: feeRate,
      ownerNet,
      owner: booking.court.owner,
      wallet: ownerWallet
        ? {
            balance: ownerWallet.balance,
            pendingBalance: ownerWallet.pendingBalance,
          }
        : null,
    };
  }

  private async creditOwner(booking: any) {
    const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
    const feeRate = setting?.feeRate ?? Number(process.env.DEFAULT_FEE_RATE ?? 0.1);

    const totalPaid = booking.match?.participants?.reduce((acc: number, p: any) => acc + (p.quota ?? 0), 0) ?? 0;
    const ownerAmount = parseFloat((totalPaid * (1 - feeRate)).toFixed(2));

    await this.ledger.creditOwnerPending(booking.court.ownerId, booking.id, ownerAmount);

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { ownerCreditedAt: new Date() },
    });

    await this.notify
      .ownerReservationReceived(booking.court.ownerId, {
        amount: ownerAmount,
        bookingId: booking.id,
        courtName: booking.court.name,
        startsAt: booking.startsAt,
      })
      .catch(() => null);

    this.logger.log(`Dono creditado: booking ${booking.id} R$${ownerAmount}`);
  }

  private async pendingOwnerAmount(ownerId: string, bookingId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: ownerId } });
    if (!wallet) return 0;
    const pendingTxs = await this.prisma.transaction.findMany({
      where: {
        walletId: wallet.id,
        bookingId,
        type: 'booking_charge',
        status: 'pending',
      },
    });
    return pendingTxs.reduce((s, t) => s + t.amount, 0);
  }

  private async releaseAndNotifyOwner(booking: {
    id: string;
    startsAt: Date;
    court: { ownerId: string; name: string };
  }) {
    const amount = await this.pendingOwnerAmount(booking.court.ownerId, booking.id);
    if (amount <= 0) return 0;

    await this.ledger.releaseOwnerFunds(booking.court.ownerId, booking.id);
    await this.notify
      .ownerReservationReceived(booking.court.ownerId, {
        amount,
        bookingId: booking.id,
        courtName: booking.court.name,
        startsAt: booking.startsAt,
        available: true,
      })
      .catch(() => null);
    return amount;
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
      const full = await this.prisma.booking.findUnique({
        where: { id: booking.id },
        include: { court: true },
      });
      if (!full) continue;

      await this.releaseAndNotifyOwner(full);
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
    const expired = await this.prisma.booking.findMany({
      where: {
        status: 'confirmed',
        endsAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
        payoutReleasedAt: null,
      },
      include: { court: true },
    });

    for (const booking of expired) {
      await this.releaseAndNotifyOwner(booking);
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'completed', payoutReleasedAt: new Date() },
      });
    }
  }
}
