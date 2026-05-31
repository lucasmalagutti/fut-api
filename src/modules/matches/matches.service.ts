import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateMatchDto } from './dto/create-match.dto';
import { JoinMatchDto } from './dto/join-match.dto';
import { MatchPaymentPreferenceDto } from './dto/match-payment-preference.dto';

@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private async assertPaymentPreference(userId: string, payment: MatchPaymentPreferenceDto) {
    if (payment.preferredPayMethod === 'card') {
      if (!payment.preferredCardId) {
        throw new BadRequestException('Selecione um cartão para cobrança automática');
      }
      const card = await this.prisma.card.findUnique({ where: { id: payment.preferredCardId } });
      if (!card || card.userId !== userId) {
        throw new NotFoundException('Cartão não encontrado');
      }
      return { preferredPayMethod: 'card' as const, preferredCardId: payment.preferredCardId };
    }
    return { preferredPayMethod: 'wallet' as const, preferredCardId: null };
  }

  // Cria a sessao de quadra (Booking) e a partida (Match) atomicamente.
  // O jogador host e automaticamente o primeiro participante.
  async create(user: User, dto: CreateMatchDto) {
    if ((user as any).blockedAt) {
      throw new BadRequestException('Conta bloqueada por pagamento pendente. Quite o saldo para criar partidas.');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: { match: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.playerId !== user.id) throw new ForbiddenException('Apenas o criador da reserva pode iniciar a partida');
    if (booking.match) throw new ConflictException('Ja existe uma partida para esta reserva');
    if (!['open', 'pending'].includes(booking.status)) {
      throw new BadRequestException('Reserva nao disponivel para criar partida');
    }

    if (dto.minPlayers > dto.maxPlayers) {
      throw new BadRequestException('minPlayers nao pode ser maior que maxPlayers');
    }

    const payPref = await this.assertPaymentPreference(user.id, dto.payment);

    const match = await this.prisma.$transaction(async (tx) => {
      const m = await tx.match.create({
        data: {
          bookingId: dto.bookingId,
          hostId: user.id,
          sport: dto.sport,
          minPlayers: dto.minPlayers,
          maxPlayers: dto.maxPlayers,
          isPublic: dto.isPublic ?? true,
          participants: {
            create: {
              userId: user.id,
              slots: 1,
              paymentStatus: 'joined',
              preferredPayMethod: payPref.preferredPayMethod,
              preferredCardId: payPref.preferredCardId,
            },
          },
        },
        include: {
          participants: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
          booking: { include: { court: true } },
        },
      });
      // Booking passa para open (partida aberta para adesoes)
      await tx.booking.update({ where: { id: dto.bookingId }, data: { status: 'open' } });
      return m;
    });

    this.logger.log(`Match created: ${match.id} by ${user.name}`);
    return match;
  }

  // Lista partidas abertas para uma quadra/data — para jogadores ingressarem
  async findOpen(courtId?: string, date?: string) {
    const where: any = {
      isPublic: true,
      closedAt: null,
      confirmedAt: null,
      booking: {
        status: 'open',
        ...(courtId && { courtId }),
        ...(date && {
          startsAt: {
            gte: new Date(`${date}T00:00:00.000Z`),
            lt: new Date(`${date}T23:59:59.999Z`),
          },
        }),
        startsAt: { gt: new Date() },
      },
    };

    return this.prisma.match.findMany({
      where,
      include: {
        booking: { include: { court: { include: { photos: true } } } },
        host: { select: { id: true, name: true, avatarUrl: true } },
        participants: {
          where: { paymentStatus: { not: 'cancelled' } },
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        },
      },
      orderBy: { booking: { startsAt: 'asc' } },
    });
  }

  // Detalhes de uma partida especifica
  async findOne(id: string) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: {
        booking: { include: { court: { include: { photos: true } } } },
        host: { select: { id: true, name: true, avatarUrl: true } },
        participants: {
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        },
        invites: { include: { to: { select: { id: true, name: true, avatarUrl: true } } } },
      },
    });
    if (!match) throw new NotFoundException('Match not found');

    // Calcula cota estimada atual (pode mudar ate fechamento)
    const activeParticipants = match.participants.filter((p) => p.paymentStatus !== 'cancelled');
    const totalSlots = activeParticipants.reduce((acc, p) => acc + p.slots, 0);
    const estimatedQuota = totalSlots > 0 ? match.booking.totalPrice / totalSlots : match.booking.totalPrice;

    return { ...match, estimatedQuota, totalSlots };
  }

  // Jogador ingressa na partida (com ou sem visitante)
  async join(matchId: string, user: User, dto: JoinMatchDto) {
    if ((user as any).blockedAt) {
      throw new BadRequestException('Conta bloqueada por pagamento pendente. Quite o saldo para ingressar em partidas.');
    }

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        booking: true,
        participants: { where: { paymentStatus: { not: 'cancelled' } } },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (match.closedAt) throw new BadRequestException('Inscricoes encerradas para esta partida');
    if (match.booking.status !== 'open') throw new BadRequestException('Partida nao esta mais aberta');

    // Verificar se ja e participante
    const existing = await this.prisma.matchParticipant.findUnique({
      where: { matchId_userId: { matchId, userId: user.id } },
    });
    if (existing && existing.paymentStatus !== 'cancelled') {
      throw new ConflictException('Voce ja esta nesta partida');
    }

    // Verificar vagas disponíveis
    const currentSlots = match.participants.reduce((acc, p) => acc + p.slots, 0);
    const slotsNeeded = dto.guestName ? 2 : 1;
    if (currentSlots + slotsNeeded > match.maxPlayers) {
      throw new BadRequestException('Sem vagas suficientes nesta partida');
    }

    const payPref = await this.assertPaymentPreference(user.id, dto.payment);

    const participant = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        return tx.matchParticipant.update({
          where: { matchId_userId: { matchId, userId: user.id } },
          data: {
            paymentStatus: 'joined',
            guestName: dto.guestName ?? null,
            slots: slotsNeeded,
            preferredPayMethod: payPref.preferredPayMethod,
            preferredCardId: payPref.preferredCardId,
          },
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        });
      }
      return tx.matchParticipant.create({
        data: {
          matchId,
          userId: user.id,
          guestName: dto.guestName ?? null,
          slots: slotsNeeded,
          paymentStatus: 'joined',
          preferredPayMethod: payPref.preferredPayMethod,
          preferredCardId: payPref.preferredCardId,
        },
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      });
    });

    // Notifica o host
    if (match.hostId !== user.id) {
      await this.notifications
        .create(match.hostId, 'match_joined', { matchId, playerName: user.name, guestName: dto.guestName })
        .catch(() => null);
    }

    this.logger.log(`${user.name} joined match ${matchId}${dto.guestName ? ` with guest ${dto.guestName}` : ''}`);
    return participant;
  }

  // Jogador sai da partida (apenas antes do fechamento T-2h)
  async leave(matchId: string, userId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { booking: true },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (match.closedAt) throw new BadRequestException('Nao e possivel sair apos o encerramento das inscricoes');
    if (match.hostId === userId) throw new BadRequestException('O organizador nao pode sair. Cancele a partida.');

    await this.prisma.matchParticipant.update({
      where: { matchId_userId: { matchId, userId } },
      data: { paymentStatus: 'cancelled' },
    });

    this.logger.log(`User ${userId} left match ${matchId}`);
    return { message: 'Saiu da partida com sucesso' };
  }

  // Convidar jogadores (apenas host)
  async invite(matchId: string, fromId: string, toIds: string[]) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match || match.hostId !== fromId) throw new ForbiddenException();
    if (match.closedAt) throw new BadRequestException('Inscricoes ja encerradas');

    const invites = await Promise.all(
      toIds.map((toId) =>
        this.prisma.matchInvite
          .create({ data: { matchId, fromId, toId, status: 'pending' } })
          .catch(() => null),
      ),
    );

    for (const toId of toIds) {
      await this.notifications.create(toId, 'match_invite', { matchId, fromId }).catch(() => null);
    }

    return invites.filter(Boolean);
  }

  // Responder convite
  async respond(
    matchId: string,
    userId: string,
    inviteId: string,
    status: 'accepted' | 'declined',
    joinDto?: JoinMatchDto,
  ) {
    const invite = await this.prisma.matchInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.toId !== userId || invite.matchId !== matchId) throw new ForbiddenException();

    await this.prisma.matchInvite.update({ where: { id: inviteId }, data: { status } });

    if (status === 'accepted') {
      if (!joinDto?.payment) {
        throw new BadRequestException('Informe a forma de pagamento ao aceitar o convite');
      }
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await this.join(matchId, user, joinDto);
      }
    }

    return { message: `Convite ${status === 'accepted' ? 'aceito' : 'recusado'}` };
  }

  // Check-in no dia da partida
  async checkIn(matchId: string, userId: string) {
    const participant = await this.prisma.matchParticipant.findUnique({
      where: { matchId_userId: { matchId, userId } },
    });
    if (!participant) throw new NotFoundException('Participante nao encontrado');
    if (participant.paymentStatus !== 'paid') {
      throw new BadRequestException('Pagamento necessario antes do check-in');
    }

    await this.prisma.matchParticipant.update({
      where: { matchId_userId: { matchId, userId } },
      data: { paymentStatus: 'checked_in' },
    });
    return { message: 'Check-in realizado' };
  }

  // Cancelar partida (apenas host, apenas se nao confirmada)
  async cancel(matchId: string, userId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { booking: true },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (match.hostId !== userId) throw new ForbiddenException('Apenas o organizador pode cancelar a partida');
    if (match.confirmedAt) {
      throw new BadRequestException('Partida ja confirmada nao pode ser cancelada. Entre em contato com o suporte.');
    }

    await this.prisma.$transaction([
      this.prisma.matchParticipant.updateMany({
        where: { matchId },
        data: { paymentStatus: 'cancelled' },
      }),
      this.prisma.booking.update({
        where: { id: match.bookingId },
        data: { status: 'cancelled' },
      }),
      this.prisma.match.update({
        where: { id: matchId },
        data: { closedAt: new Date() },
      }),
    ]);

    this.logger.log(`Match ${matchId} cancelled by host ${userId}`);
    return { message: 'Partida cancelada com sucesso' };
  }

  // Minhas partidas (como participante ou host)
  async findMine(userId: string) {
    return this.prisma.match.findMany({
      where: {
        OR: [
          { hostId: userId },
          { participants: { some: { userId, paymentStatus: { not: 'cancelled' } } } },
        ],
      },
      include: {
        booking: { include: { court: { include: { photos: true } } } },
        host: { select: { id: true, name: true, avatarUrl: true } },
        participants: {
          where: { paymentStatus: { not: 'cancelled' } },
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        },
      },
      orderBy: { booking: { startsAt: 'desc' } },
    });
  }
}
