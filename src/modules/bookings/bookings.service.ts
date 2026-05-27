import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async create(player: User, dto: CreateBookingDto) {
    if (player.role !== 'player') throw new ForbiddenException('Only players can create bookings');

    const court = await this.prisma.court.findUnique({
      where: { id: dto.courtId },
      include: { schedules: true },
    });
    if (!court || court.status !== 'active') throw new NotFoundException('Court not found');

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    const durationMs = endsAt.getTime() - startsAt.getTime();
    const durationHours = durationMs / (1000 * 60 * 60); // sempre em horas
    const dayOfWeek = startsAt.getDay();
    const schedule = court.schedules.find((s) => s.dayOfWeek === dayOfWeek);
    const pricePerHour = schedule?.basePrice ?? 0;
    const totalPrice = parseFloat((pricePerHour * durationHours).toFixed(2));

    const booking = await this.prisma.$transaction(async (tx) => {
      // Reservas pending sem pagamento expiram em 30 minutos (TTL)
      const pendingTTL = new Date(Date.now() - 30 * 60 * 1000);

      const overlap = await tx.booking.findFirst({
        where: {
          courtId: dto.courtId,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          OR: [
            // Confirmadas sempre bloqueiam
            { status: 'confirmed' },
            // Open (aguardando quorum) bloqueiam
            { status: 'open' },
            // Pending sem pagamento expiram em 30min
            { status: 'pending', createdAt: { gt: pendingTTL } },
          ],
        },
      });
      if (overlap) throw new ConflictException('Time slot already booked');

      return tx.booking.create({
        data: {
          courtId: dto.courtId,
          playerId: player.id,
          startsAt,
          endsAt,
          totalPrice,
          status: 'open',
        },
        include: { court: true },
      });
    });

    await this.mail
      .sendBookingConfirmation(player.email, booking.id, booking.court.name, startsAt)
      .catch(() => null);

    return booking;
  }

  async findMine(userId: string, role: string, query: { q?: string; status?: string }) {
    return this.prisma.booking.findMany({
      where: {
        ...(role === 'player' ? { playerId: userId } : { court: { ownerId: userId } }),
        ...(query.status && { status: query.status as any }),
        ...(query.q && { court: { name: { contains: query.q } } }),
      },
      include: { court: { include: { photos: true } }, payment: true },
      orderBy: { startsAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { court: true, payment: true, review: true, match: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async cancel(userId: string, id: string, reason?: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { court: true, payment: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.playerId !== userId && booking.court.ownerId !== userId) {
      throw new ForbiddenException();
    }
    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new BadRequestException('Cannot cancel this booking');
    }

    const refundWindowHours = parseInt(process.env.REFUND_WINDOW_HOURS ?? '24');
    const hoursUntilStart = (booking.startsAt.getTime() - Date.now()) / 3600000;
    const shouldRefund = hoursUntilStart > refundWindowHours;

    await this.prisma.booking.update({
      where: { id },
      data: { status: 'cancelled', cancellationReason: reason },
    });

    if (shouldRefund && booking.payment?.status === 'paid') {
      await this.prisma.payment.update({ where: { bookingId: id }, data: { status: 'refunded' } });
    }

    return { message: 'Booking cancelled', refunded: shouldRefund };
  }

  async createReview(userId: string, bookingId: string, dto: CreateReviewDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { review: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.playerId !== userId) throw new ForbiddenException();
    if (booking.status !== 'completed') throw new BadRequestException('Booking not completed yet');
    if (booking.review) throw new BadRequestException('Already reviewed');

    const review = await this.prisma.review.create({
      data: {
        bookingId,
        fromId: userId,
        courtId: booking.courtId,
        rating: dto.rating,
        comment: dto.comment,
      },
    });

    const agg = await this.prisma.review.aggregate({
      where: { courtId: booking.courtId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await this.prisma.court.update({
      where: { id: booking.courtId },
      data: {
        ratingAvg: agg._avg.rating ?? 0,
        ratingCount: agg._count.rating,
      },
    });

    return review;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async completeExpiredBookings() {
    await this.prisma.booking.updateMany({
      where: { status: 'confirmed', endsAt: { lt: new Date() } },
      data: { status: 'completed' },
    });
  }

  // Cancela reservas pending sem pagamento apos 30 minutos (libera o slot)
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expirePendingBookings() {
    const ttl = new Date(Date.now() - 30 * 60 * 1000);
    const expired = await this.prisma.booking.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: ttl },
        payment: null,
      },
      select: { id: true },
    });

    if (expired.length > 0) {
      await this.prisma.booking.updateMany({
        where: { id: { in: expired.map((b) => b.id) } },
        data: { status: 'cancelled', cancellationReason: 'Payment timeout' },
      });
    }
  }
}
