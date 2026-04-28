import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateMatchDto } from './dto/create-match.dto';

@Injectable()
export class MatchesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(user: User, dto: CreateMatchDto) {
    const booking = await this.prisma.booking.findUnique({ where: { id: dto.bookingId } });
    if (!booking || booking.playerId !== user.id) throw new ForbiddenException();

    return this.prisma.match.create({
      data: {
        bookingId: dto.bookingId,
        hostId: user.id,
        sport: dto.sport,
        slots: dto.slots,
        pricePerPlayer: dto.pricePerPlayer,
        isPublic: dto.isPublic ?? false,
        participants: { create: { userId: user.id, status: 'joined' } },
      },
      include: { participants: true },
    });
  }

  async findOne(id: string) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: { participants: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } }, invites: true },
    });
    if (!match) throw new NotFoundException('Match not found');
    return match;
  }

  async invite(matchId: string, fromId: string, toIds: string[]) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match || match.hostId !== fromId) throw new ForbiddenException();

    const invites = await Promise.all(
      toIds.map((toId) =>
        this.prisma.matchInvite.upsert({
          where: { id: `${matchId}_${toId}` },
          update: {},
          create: { matchId, fromId, toId, status: 'pending' },
        }).catch(() =>
          this.prisma.matchInvite.create({ data: { matchId, fromId, toId, status: 'pending' } }),
        ),
      ),
    );

    for (const toId of toIds) {
      await this.notifications.create(toId, 'match_invite', { matchId, fromId }).catch(() => null);
    }

    return invites;
  }

  async respond(matchId: string, userId: string, inviteId: string, status: 'accepted' | 'declined') {
    const invite = await this.prisma.matchInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.toId !== userId || invite.matchId !== matchId) throw new ForbiddenException();

    await this.prisma.matchInvite.update({ where: { id: inviteId }, data: { status } });

    if (status === 'accepted') {
      await this.prisma.matchParticipant.upsert({
        where: { matchId_userId: { matchId, userId } },
        update: { status: 'joined' },
        create: { matchId, userId, status: 'joined' },
      });
    }

    return { message: `Invite ${status}` };
  }

  async checkIn(matchId: string, userId: string) {
    await this.prisma.matchParticipant.update({
      where: { matchId_userId: { matchId, userId } },
      data: { status: 'checked_in' },
    });
    return { message: 'Checked in' };
  }

  async leave(matchId: string, userId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException();
    if (match.hostId === userId) throw new BadRequestException('Host cannot leave the match');

    await this.prisma.matchParticipant.update({
      where: { matchId_userId: { matchId, userId } },
      data: { status: 'cancelled' },
    });
    return { message: 'Left match' };
  }
}
