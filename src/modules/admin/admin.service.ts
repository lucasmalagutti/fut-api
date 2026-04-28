import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async listUsers(query: { role?: string; status?: string; q?: string; order?: string }) {
    const users = await this.prisma.user.findMany({
      where: {
        ...(query.role && { role: query.role as any }),
        ...(query.status && { status: query.status as any }),
        ...(query.q && { OR: [{ name: { contains: query.q } }, { email: { contains: query.q } }] }),
      },
      orderBy: query.order === 'name' ? { name: 'asc' } : { createdAt: 'desc' },
    });
    return users.map(({ passwordHash: _, ...u }) => u);
  }

  async updateUser(
    actorId: string,
    userId: string,
    data: { status?: string; banReason?: string; password?: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updateData: any = {};
    if (data.status) updateData.status = data.status;
    if (data.banReason) updateData.banReason = data.banReason;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);

    const updated = await this.prisma.user.update({ where: { id: userId }, data: updateData });

    if (data.status === 'banned' || data.status === 'inactive') {
      await this.notifications
        .create(userId, 'ban_warning', { reason: data.banReason ?? 'Violação dos termos de uso' })
        .catch(() => null);
    }

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'admin.updateUser',
        target: userId,
        payload: JSON.stringify(data),
      },
    });

    const { passwordHash: _, ...safe } = updated;
    return safe;
  }

  async deleteUser(actorId: string, userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'deleted' } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'admin.deleteUser', target: userId, payload: '{}' },
    });
    return { message: 'User deleted' };
  }

  async listReports(status?: string) {
    return this.prisma.report.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        reporter: { select: { id: true, name: true } },
        reportedUser: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateReport(reportId: string, resolvedById: string, data: { status: string; resolutionNote?: string }) {
    return this.prisma.report.update({
      where: { id: reportId },
      data: { status: data.status as any, resolutionNote: data.resolutionNote, resolvedById },
    });
  }

  async getDashboard(from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const [bookingsCount, paymentsAgg, newUsers, newOwners] = await Promise.all([
      this.prisma.booking.count({ where: { createdAt: { gte: fromDate, lte: toDate } } }),
      this.prisma.payment.aggregate({
        where: { status: 'paid', createdAt: { gte: fromDate, lte: toDate } },
        _sum: { fee: true, amount: true },
      }),
      this.prisma.user.count({
        where: { role: 'player', createdAt: { gte: fromDate, lte: toDate } },
      }),
      this.prisma.user.count({
        where: { role: 'owner', createdAt: { gte: fromDate, lte: toDate } },
      }),
    ]);

    return {
      period: { from, to },
      bookings: bookingsCount,
      revenue: paymentsAgg._sum.amount ?? 0,
      platformFees: paymentsAgg._sum.fee ?? 0,
      newPlayers: newUsers,
      newOwners,
    };
  }

  async getFeeRate() {
    const setting = await this.prisma.platformSetting.findUnique({ where: { id: 1 } });
    return { feeRate: setting?.feeRate ?? 0.1 };
  }

  async updateFeeRate(actorId: string, feeRate: number) {
    const setting = await this.prisma.platformSetting.upsert({
      where: { id: 1 },
      update: { feeRate, updatedById: actorId },
      create: { id: 1, feeRate, updatedById: actorId },
    });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'admin.updateFeeRate', target: 'platform', payload: JSON.stringify({ feeRate }) },
    });
    return setting;
  }
}
