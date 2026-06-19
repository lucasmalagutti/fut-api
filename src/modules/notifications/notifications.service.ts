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
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((n) => ({
      ...n,
      payload: this.parsePayload(n.payload),
    }));
  }

  private parsePayload(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
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

    const body = this.bodyFor(type, payload);
    const messages = tokens.map((t) => ({
      to: t.expoToken,
      title: this.titleFor(type),
      body,
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
      match_joined: 'Novo jogador na partida',
      match_join_confirmed: 'Você entrou na partida',
      match_cancelled_quorum: 'Partida cancelada',
      payment_charged: 'Pagamento realizado',
      deposit_confirmed: 'Depósito confirmado',
      booking_confirmed: 'Reserva confirmada',
      pix_payment_required: 'PIX pendente',
      account_blocked_pix: 'Conta bloqueada',
      payout_completed: 'Saque realizado',
      payment_received: 'Reserva recebida',
      owner_funds_available: 'Valor disponível',
      payment_charge_failed: 'Falha na cobrança',
      booking_reminder: 'Lembrete de reserva',
      ban_warning: 'Aviso da plataforma',
    };
    return map[type] ?? 'FutMatch';
  }

  private bodyFor(type: string, payload: object) {
    const p = payload as Record<string, unknown>;
    if (typeof p.message === 'string') return p.message;
    return this.titleFor(type);
  }
}
