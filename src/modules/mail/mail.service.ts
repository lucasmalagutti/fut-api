import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private from: string;
  private readonly logger = new Logger(MailService.name);
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM', 'FutMatch <no-reply@futmatch.app>');
    const user = config.get('MAIL_USER', '');
    const pass = config.get('MAIL_PASS', '');

    // Desabilita envio se credenciais nao foram configuradas
    this.enabled =
      !!user && user !== 'your_mailtrap_user' && !!pass && pass !== 'your_mailtrap_pass';

    if (!this.enabled) {
      this.logger.warn('Email desabilitado -- configure MAIL_USER e MAIL_PASS no .env para habilitar');
    }

    this.transporter = nodemailer.createTransport({
      host: config.get('MAIL_HOST', 'smtp.mailtrap.io'),
      port: config.get<number>('MAIL_PORT', 2525),
      auth: { user, pass },
    });
  }

  async sendWelcome(to: string, name: string) {
    await this.send(to, 'Bem-vindo ao FutMatch!', `Ola ${name}, sua conta foi criada com sucesso.`);
  }

  async sendBookingConfirmation(to: string, bookingId: string, courtName: string, startsAt: Date) {
    await this.send(
      to,
      'Reserva confirmada - FutMatch',
      `Sua reserva na quadra "${courtName}" para ${startsAt.toLocaleString('pt-BR')} foi confirmada. ID: ${bookingId}`,
    );
  }

  async sendPasswordReset(to: string, token: string) {
    await this.send(
      to,
      'Redefinicao de senha - FutMatch',
      `Use o token abaixo para redefinir sua senha (valido por 1h):\n\n${token}`,
    );
  }

  private async send(to: string, subject: string, text: string) {
    if (!this.enabled) return;
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text });
      this.logger.log(`Mail sent to ${to}: ${subject}`);
    } catch (err) {
      this.logger.warn(`Mail to ${to} failed: ${err}`);
    }
  }
}
