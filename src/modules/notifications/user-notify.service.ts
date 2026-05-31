import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from './notifications.service';

function formatBrl(amount: number) {
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

@Injectable()
export class UserNotifyService {
  private readonly logger = new Logger(UserNotifyService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private mail: MailService,
  ) {}

  async bookingConfirmed(
    userId: string,
    data: { bookingId: string; courtName: string; startsAt: Date },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const when = data.startsAt.toLocaleString('pt-BR');
    const message = `Sua reserva em "${data.courtName}" para ${when} foi confirmada.`;

    await this.notifications
      .create(userId, 'booking_confirmed', {
        bookingId: data.bookingId,
        courtName: data.courtName,
        startsAt: data.startsAt.toISOString(),
        message,
      })
      .catch((err) => this.logger.warn(`Notificação booking_confirmed: ${err.message}`));

    await this.mail
      .sendBookingConfirmation(user.email, data.bookingId, data.courtName, data.startsAt)
      .catch(() => null);
  }

  async paymentCompleted(
    userId: string,
    data: {
      amount: number;
      method?: string;
      purpose?: string;
      bookingId?: string;
      matchId?: string;
      courtName?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const message =
      data.courtName != null
        ? `Pagamento de ${formatBrl(data.amount)} em "${data.courtName}" efetuado com sucesso.`
        : `Pagamento de ${formatBrl(data.amount)} efetuado com sucesso.`;

    await this.notifications
      .create(userId, 'payment_charged', {
        amount: data.amount,
        method: data.method,
        purpose: data.purpose,
        bookingId: data.bookingId,
        matchId: data.matchId,
        courtName: data.courtName,
        message,
      })
      .catch((err) => this.logger.warn(`Notificação payment_charged: ${err.message}`));

    await this.mail
      .sendPaymentSuccess(user.email, data.amount, {
        method: data.method,
        courtName: data.courtName,
      })
      .catch(() => null);
  }

  /** Dono: valor da reserva creditado (pendente ou já disponível) */
  async ownerReservationReceived(
    ownerId: string,
    data: {
      amount: number;
      bookingId: string;
      courtName: string;
      startsAt?: Date;
      available?: boolean;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: ownerId } });
    if (!user) return;

    const when = data.startsAt?.toLocaleString('pt-BR');
    const schedule = when ? ` (${when})` : '';
    const message = data.available
      ? `${formatBrl(data.amount)} da reserva em "${data.courtName}"${schedule} está disponível para saque.`
      : `Você recebeu ${formatBrl(data.amount)} da reserva em "${data.courtName}"${schedule}. O valor fica pendente até o fim da partida.`;

    const type = data.available ? 'owner_funds_available' : 'payment_received';

    await this.notifications
      .create(ownerId, type, {
        amount: data.amount,
        bookingId: data.bookingId,
        courtName: data.courtName,
        startsAt: data.startsAt?.toISOString(),
        message,
      })
      .catch((err) => this.logger.warn(`Notificação ${type}: ${err.message}`));

    await this.mail
      .sendOwnerReservationReceived(user.email, data.amount, data.courtName, {
        available: data.available,
        when,
      })
      .catch(() => null);
  }

  async depositConfirmed(userId: string, data: { amount: number; paymentId?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const message = `Depósito de ${formatBrl(data.amount)} confirmado na sua carteira.`;

    await this.notifications
      .create(userId, 'deposit_confirmed', {
        amount: data.amount,
        paymentId: data.paymentId,
        message,
      })
      .catch((err) => this.logger.warn(`Notificação deposit_confirmed: ${err.message}`));

    await this.mail.sendDepositConfirmed(user.email, data.amount).catch(() => null);
  }
}
