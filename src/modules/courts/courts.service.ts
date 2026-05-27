import {
  BadRequestException,
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

// Desserializa court do banco: amenities JSON → array, sport JSON → string[] ou string
function parseCourt<T extends { amenities: string; sport: string }>(court: T) {
  let sports: string[];
  try {
    const parsed = JSON.parse(court.sport);
    sports = Array.isArray(parsed) ? parsed : [court.sport];
  } catch {
    sports = court.sport ? [court.sport] : [];
  }
  return {
    ...court,
    sports,
    // Mantém sport como primeiro esporte para retrocompat
    sport: sports[0] ?? court.sport,
    amenities: (() => { try { return JSON.parse(court.amenities || '[]'); } catch { return []; } })(),
  };
}

@Injectable()
export class CourtsService {
  constructor(private prisma: PrismaService) {}

  async create(owner: User, dto: CreateCourtDto) {
    const ownerCourts = await this.prisma.court.findMany({
      where: { ownerId: owner.id, status: { not: 'inactive' } },
      select: { name: true },
    });
    const duplicate = ownerCourts.some(
      (c) => c.name.trim().toLowerCase() === dto.name.trim().toLowerCase(),
    );
    if (duplicate) throw new BadRequestException('Você já possui uma quadra com esse nome.');

    // sport armazena JSON array quando multiplos esportes, string simples quando unico (retrocompat)
    const sportValue = Array.isArray(dto.sports)
      ? JSON.stringify(dto.sports)
      : (dto.sport ?? '');

    const court = await this.prisma.court.create({
      data: {
        ownerId: owner.id,
        name: dto.name,
        sport: sportValue,
        description: dto.description,
        addressLine: dto.addressLine,
        city: dto.city,
        state: dto.state,
        zip: dto.zip,
        latitude: dto.latitude,
        longitude: dto.longitude,
        amenities: JSON.stringify(dto.amenities ?? []),
        rules: dto.rules || undefined,
        mapsUrl: dto.mapsUrl || undefined,
      },
      include: { photos: { orderBy: { createdAt: 'asc' } }, schedules: true },
    });
    return parseCourt(court);
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
    ownerId?: string;
  }) {
    const courts = await this.prisma.court.findMany({
      where: {
        ...(query.ownerId ? { ownerId: query.ownerId } : { status: 'active' }),
        // Filtro de esporte: usa contains para suportar JSON array armazenado
        ...(query.sport && { sport: { contains: query.sport } }),
        ...(query.q && { name: { contains: query.q } }),
        ...(query.ratingMin && { ratingAvg: { gte: parseFloat(query.ratingMin) } }),
      },
      include: { photos: { orderBy: { createdAt: 'asc' } }, schedules: true },
    });

    type CourtRow = ReturnType<typeof parseCourt<(typeof courts)[number]>> & { distanceKm: number | undefined };

    let result: CourtRow[] = courts.map((c) => ({
      ...parseCourt(c),
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
      include: { photos: { orderBy: { createdAt: 'asc' } }, schedules: true, blocks: true },
    });
    if (!court) throw new NotFoundException('Court not found');
    return parseCourt(court);
  }

  async update(owner: User, id: string, dto: UpdateCourtDto) {
    await this.assertOwner(owner.id, id);
    const { amenities, sports, sport, ...rest } = dto as any;

    const sportValue = Array.isArray(sports)
      ? JSON.stringify(sports)
      : (sport !== undefined ? sport : undefined);

    const court = await this.prisma.court.update({
      where: { id },
      data: {
        ...rest,
        ...(sportValue !== undefined && { sport: sportValue }),
        ...(amenities !== undefined && { amenities: JSON.stringify(amenities) }),
      },
    });
    return parseCourt(court);
  }

  async remove(owner: User, id: string) {
    await this.assertOwner(owner.id, id);
    await this.prisma.court.update({ where: { id }, data: { status: 'inactive' } });
    return { message: 'Court deactivated' };
  }

  async addPhoto(owner: User, courtId: string, url: string, position = 0) {
    await this.assertOwner(owner.id, courtId);
    const count = await this.prisma.courtPhoto.count({ where: { courtId } });
    if (count >= 5) throw new BadRequestException('Máximo de 5 fotos por quadra.');
    return this.prisma.courtPhoto.create({ data: { courtId, url, position } });
  }

  async removePhoto(owner: User, courtId: string, photoId: string) {
    await this.assertOwner(owner.id, courtId);
    await this.prisma.courtPhoto.delete({ where: { id: photoId } });
    return { message: 'Photo removed' };
  }

  async getSchedulesByCourtId(courtId: string) {
    return this.prisma.courtSchedule.findMany({
      where: { courtId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async getBlocksByCourtId(courtId: string) {
    return this.prisma.courtBlock.findMany({
      where: { courtId },
      orderBy: { startsAt: 'asc' },
    });
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

  async removeBlock(owner: User, courtId: string, blockId: string) {
    await this.assertOwner(owner.id, courtId);
    await this.prisma.courtBlock.delete({ where: { id: blockId } });
    return { message: 'Block removed' };
  }

  async removeSchedule(owner: User, courtId: string, scheduleId: string) {
    await this.assertOwner(owner.id, courtId);
    await this.prisma.courtSchedule.delete({ where: { id: scheduleId } });
    return { message: 'Schedule removed' };
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
    if (!schedule) return { date: dateStr, open: false, openTime: null, closeTime: null, pricePerHour: 0, unavailable: [] };

    // Day boundaries
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Collect unavailable windows (blocks + confirmed bookings) for this day
    const unavailable: { startsAt: string; endsAt: string; reason: 'block' | 'booking' }[] = [];

    court.blocks
      .filter((b) => b.startsAt < dayEnd && b.endsAt > dayStart)
      .forEach((b) => unavailable.push({ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), reason: 'block' }));

    const pendingTTL = new Date(Date.now() - 30 * 60 * 1000);
    court.bookings
      .filter((b) => {
        if (!['pending', 'confirmed'].includes(b.status)) return false;
        if (b.startsAt >= dayEnd || b.endsAt <= dayStart) return false;
        // Pending sem pagamento expiram em 30min — nao bloquear slot na UI
        if (b.status === 'pending' && b.createdAt < pendingTTL) return false;
        return true;
      })
      .forEach((b) => unavailable.push({ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), reason: 'booking' }));

    return {
      date: dateStr,
      open: true,
      openTime: schedule.openTime,
      closeTime: schedule.closeTime,
      pricePerHour: schedule.basePrice,
      unavailable,
    };
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
