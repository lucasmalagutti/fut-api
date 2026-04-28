import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBlockDto } from './dto/create-block.dto';
import { CreateCourtDto } from './dto/create-court.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateCourtDto } from './dto/update-court.dto';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class CourtsService {
  constructor(private prisma: PrismaService) {}

  async create(owner: User, dto: CreateCourtDto) {
    return this.prisma.court.create({
      data: {
        ownerId: owner.id,
        name: dto.name,
        sport: dto.sport,
        description: dto.description,
        addressLine: dto.addressLine,
        city: dto.city,
        state: dto.state,
        zip: dto.zip,
        latitude: dto.latitude,
        longitude: dto.longitude,
        amenities: JSON.stringify(dto.amenities ?? []),
        rules: dto.rules,
      },
      include: { photos: true, schedules: true },
    });
  }

  async findAll(query: {
    lat?: string;
    lng?: string;
    radius?: string;
    sport?: string;
    date?: string;
    priceMin?: string;
    priceMax?: string;
    ratingMin?: string;
    q?: string;
    order?: string;
  }) {
    const courts = await this.prisma.court.findMany({
      where: {
        status: 'active',
        ...(query.sport && { sport: query.sport }),
        ...(query.q && { name: { contains: query.q } }),
        ...(query.ratingMin && { ratingAvg: { gte: parseFloat(query.ratingMin) } }),
      },
      include: { photos: true, schedules: true },
    });

    let result = courts.map((c) => ({
      ...c,
      amenities: JSON.parse(c.amenities || '[]'),
      distanceKm: undefined as number | undefined,
    }));

    if (query.lat && query.lng) {
      const lat = parseFloat(query.lat);
      const lng = parseFloat(query.lng);
      const radius = parseFloat(query.radius ?? '50');
      result = result
        .map((c) => ({ ...c, distanceKm: haversineKm(lat, lng, c.latitude, c.longitude) }))
        .filter((c) => c.distanceKm! <= radius);
    }

    if (query.priceMin || query.priceMax) {
      result = result.filter((c) => {
        const prices = c.schedules.map((s) => s.basePrice);
        if (!prices.length) return false;
        const min = Math.min(...prices);
        if (query.priceMin && min < parseFloat(query.priceMin)) return false;
        if (query.priceMax && min > parseFloat(query.priceMax)) return false;
        return true;
      });
    }

    if (query.order === 'price') result.sort((a, b) => (a.schedules[0]?.basePrice ?? 0) - (b.schedules[0]?.basePrice ?? 0));
    else if (query.order === 'rating') result.sort((a, b) => b.ratingAvg - a.ratingAvg);
    else if (query.lat) result.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

    return result;
  }

  async findOne(id: string) {
    const court = await this.prisma.court.findUnique({
      where: { id },
      include: { photos: true, schedules: true, blocks: true },
    });
    if (!court) throw new NotFoundException('Court not found');
    return { ...court, amenities: JSON.parse(court.amenities || '[]') };
  }

  async update(owner: User, id: string, dto: UpdateCourtDto) {
    await this.assertOwner(owner.id, id);
    const { amenities, ...rest } = dto;
    return this.prisma.court.update({
      where: { id },
      data: {
        ...rest,
        ...(amenities !== undefined && { amenities: JSON.stringify(amenities) }),
      },
    });
  }

  async remove(owner: User, id: string) {
    await this.assertOwner(owner.id, id);
    await this.prisma.court.update({ where: { id }, data: { status: 'inactive' } });
    return { message: 'Court deactivated' };
  }

  async addPhoto(owner: User, courtId: string, url: string, position = 0) {
    await this.assertOwner(owner.id, courtId);
    return this.prisma.courtPhoto.create({ data: { courtId, url, position } });
  }

  async addSchedule(owner: User, courtId: string, dto: CreateScheduleDto) {
    await this.assertOwner(owner.id, courtId);
    return this.prisma.courtSchedule.create({ data: { courtId, ...dto } });
  }

  async addBlock(owner: User, courtId: string, dto: CreateBlockDto) {
    await this.assertOwner(owner.id, courtId);
    return this.prisma.courtBlock.create({
      data: { courtId, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt), reason: dto.reason },
    });
  }

  async getAvailability(courtId: string, dateStr: string) {
    const court = await this.prisma.court.findUnique({
      where: { id: courtId },
      include: { schedules: true, blocks: true, bookings: true },
    });
    if (!court) throw new NotFoundException('Court not found');

    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const schedule = court.schedules.find((s) => s.dayOfWeek === dayOfWeek);
    if (!schedule) return { date: dateStr, slots: [] };

    const [openH, openM] = schedule.openTime.split(':').map(Number);
    const [closeH, closeM] = schedule.closeTime.split(':').map(Number);

    const slots: { startsAt: string; endsAt: string; available: boolean; price: number }[] = [];
    let cursor = new Date(date);
    cursor.setHours(openH, openM, 0, 0);
    const end = new Date(date);
    end.setHours(closeH, closeM, 0, 0);

    while (cursor < end) {
      const slotEnd = new Date(cursor.getTime() + schedule.slotMinutes * 60 * 1000);
      if (slotEnd > end) break;

      const blocked = court.blocks.some(
        (b) => b.startsAt < slotEnd && b.endsAt > cursor,
      );
      const booked = court.bookings.some(
        (b) =>
          ['pending', 'confirmed'].includes(b.status) &&
          b.startsAt < slotEnd &&
          b.endsAt > cursor,
      );

      slots.push({
        startsAt: cursor.toISOString(),
        endsAt: slotEnd.toISOString(),
        available: !blocked && !booked,
        price: schedule.basePrice,
      });
      cursor = slotEnd;
    }

    return { date: dateStr, slots };
  }

  async getReviews(courtId: string) {
    return this.prisma.review.findMany({
      where: { courtId },
      include: { from: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertOwner(ownerId: string, courtId: string) {
    const court = await this.prisma.court.findUnique({ where: { id: courtId } });
    if (!court) throw new NotFoundException('Court not found');
    if (court.ownerId !== ownerId) throw new ForbiddenException('Not your court');
  }
}
