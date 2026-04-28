import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private from: string;
  private readonly logger = new Logger(MailService.name);

  constructor(config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM', 'FutMatch <no-reply@futmatch.app>');
    this.transporter = nodemailer.createTransport({
      host: config.get('MAIL_HOST', 'smtp.mailtrap.io'),
      port: config.get<number>('MAIL_PORT', 2525),
      auth: {
        user: config.get('MAIL_USER', ''),
        pass: config.get('MAIL_PASS', ''),
      },
    });
  }

  async sendWelcome(to: string, name: string) {
    await this.send(to, 'Bem-vindo ao FutMatch!', `Olá ${name}, sua conta foi criada com sucesso.`);
  }

  async sendBookingConfirmation(to: string, bookingId: string, courtName: string, startsAt: Date) {
    await this.send(
      to,
      'Reserva confirmada – FutMatch',
      `Sua reserva na quadra "${courtName}" para ${startsAt.toLocaleString('pt-BR')} foi confirmada. ID: ${bookingId}`,
    );
  }

  async sendPasswordReset(to: string, token: string) {
    await this.send(
      to,
      'Redefinição de senha – FutMatch',
      `Use o token abaixo para redefinir sua senha (válido por 1h):\n\n${token}`,
    );
  }

  private async send(to: string, subject: string, text: string) {
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text });
    } catch (err) {
      this.logger.warn(`Mail to ${to} failed: ${err}`);
    }
  }
}
