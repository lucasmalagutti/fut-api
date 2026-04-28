import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async create(userId: string, type: string, payload: object) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, payload: JSON.stringify(payload) },
    });
    await this.sendPush(userId, type, payload);
    return notification;
  }

  async findAll(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { message: 'All notifications marked as read' };
  }

  async registerDevice(userId: string, expoToken: string, platform: string) {
    return this.prisma.deviceToken.upsert({
      where: { expoToken },
      update: { userId, platform },
      create: { userId, expoToken, platform },
    });
  }

  private async sendPush(userId: string, type: string, payload: object) {
    const tokens = await this.prisma.deviceToken.findMany({ where: { userId } });
    if (!tokens.length) return;

    const messages = tokens.map((t) => ({
      to: t.expoToken,
      title: this.titleFor(type),
      body: JSON.stringify(payload),
      data: payload,
    }));

    const accessToken = this.config.get('EXPO_PUSH_ACCESS_TOKEN');
    if (!accessToken) {
      this.logger.debug(`[Push mock] ${type} → ${userId}: ${JSON.stringify(payload)}`);
      return;
    }

    try {
      const { default: fetch } = await import('node-fetch' as any).catch(() => ({ default: globalThis.fetch }));
      await (fetch as Function)('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(messages),
      });
    } catch (err) {
      this.logger.warn(`Push failed: ${err}`);
    }
  }

  private titleFor(type: string) {
    const map: Record<string, string> = {
      match_invite: 'Convite para partida',
      booking_reminder: 'Lembrete de reserva',
      ban_warning: 'Aviso da plataforma',
    };
    return map[type] ?? 'FutMatch';
  }
}
