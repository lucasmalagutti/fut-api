import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService implements OnModuleInit {
  private transporter: nodemailer.Transporter;
  private from: string;
  private readonly logger = new Logger(MailService.name);
  private readonly enabled: boolean;

  constructor(private config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM', 'FutMatch <no-reply@futmatch.app>');
    const user = (config.get<string>('MAIL_USER', '') ?? '').trim();
    const pass = (config.get<string>('MAIL_PASS', '') ?? '').trim();
    const port = parseInt(config.get<string>('MAIL_PORT', '2525'), 10);
    const secure =
      config.get<string>('MAIL_SECURE', '') === 'true' || port === 465;

    this.enabled =
      !!user &&
      !!pass &&
      user !== 'your_mailtrap_user' &&
      pass !== 'your_mailtrap_pass';

    if (!this.enabled) {
      this.logger.warn(
        'E-mail desabilitado — preencha MAIL_USER e MAIL_PASS do Mailtrap no .env (Sandboxes → Integration → SMTP)',
      );
    }

    this.transporter = nodemailer.createTransport({
      host: config.get<string>('MAIL_HOST', 'sandbox.smtp.mailtrap.io'),
      port,
      secure,
      auth: this.enabled ? { user, pass } : undefined,
    });
  }

  async onModuleInit() {
    if (!this.enabled) return;
    try {
      await this.transporter.verify();
      this.logger.log(
        `SMTP conectado (${this.config.get('MAIL_HOST', 'sandbox.smtp.mailtrap.io')}:${this.config.get('MAIL_PORT', '2525')})`,
      );
    } catch (err) {
      this.logger.error(
        `Falha ao conectar SMTP — confira MAIL_* no .env: ${(err as Error).message}`,
      );
    }
  }

  async sendWelcome(to: string, name: string) {
    await this.send(
      to,
      'Bem-vindo ao FutMatch!',
      `Olá ${name},\n\nSua conta foi criada com sucesso. Bem-vindo ao FutMatch!`,
    );
  }

  async sendBookingConfirmation(to: string, bookingId: string, courtName: string, startsAt: Date) {
    const when = startsAt.toLocaleString('pt-BR');
    await this.send(
      to,
      'Reserva confirmada - FutMatch',
      `Sua reserva na quadra "${courtName}" para ${when} foi confirmada.\n\nCódigo da reserva: ${bookingId}`,
    );
  }

  async sendPaymentSuccess(
    to: string,
    amount: number,
    opts?: { method?: string; courtName?: string },
  ) {
    const formatted = amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const methodLabel =
      opts?.method === 'wallet'
        ? 'carteira'
        : opts?.method === 'card'
          ? 'cartão'
          : opts?.method === 'pix'
            ? 'PIX'
            : undefined;
    const where = opts?.courtName ? ` na partida/reserva em "${opts.courtName}"` : '';
    const via = methodLabel ? ` via ${methodLabel}` : '';
    await this.send(
      to,
      'Pagamento efetuado - FutMatch',
      `Seu pagamento de ${formatted}${via}${where} foi confirmado.`,
    );
  }

  async sendOwnerReservationReceived(
    to: string,
    amount: number,
    courtName: string,
    opts?: { available?: boolean; when?: string },
  ) {
    const formatted = amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const schedule = opts?.when ? ` (${opts.when})` : '';
    const text = opts?.available
      ? `${formatted} da reserva em "${courtName}"${schedule} está disponível para saque na sua carteira FutMatch.`
      : `Você recebeu ${formatted} da reserva em "${courtName}"${schedule}. O valor ficará pendente até a conclusão da partida.`;
    const subject = opts?.available
      ? 'Valor disponível para saque - FutMatch'
      : 'Reserva recebida - FutMatch';
    await this.send(to, subject, text);
  }

  async sendDepositConfirmed(to: string, amount: number) {
    const formatted = amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    await this.send(
      to,
      'Depósito confirmado - FutMatch',
      `Seu depósito de ${formatted} foi creditado na carteira FutMatch.`,
    );
  }

  async sendPayoutSuccess(to: string, amount: number) {
    const formatted = amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const text = `Seu saque de ${formatted} foi realizado com sucesso.`;
    await this.send(to, 'Saque realizado - FutMatch', text);
  }

  async sendPasswordReset(to: string, token: string) {
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:8081');
    await this.send(
      to,
      'Redefinição de senha - FutMatch',
      `Você solicitou a redefinição de senha.\n\nToken (válido por 1h):\n${token}\n\nNo app, use a tela "Esqueci minha senha" e cole este token.\n\nOu acesse: ${appUrl}/(auth)/forgot-password`,
    );
  }

  /** Envia e-mail de teste (dev / validação Mailtrap) */
  async sendTest(to: string) {
    const ok = await this.send(
      to,
      'Teste FutMatch — Mailtrap',
      `Se você está lendo isto no Mailtrap, o SMTP está configurado corretamente.\n\nEnviado em: ${new Date().toLocaleString('pt-BR')}`,
      '<p>Se você está lendo isto no <strong>Mailtrap</strong>, o SMTP está OK.</p>',
    );
    if (!ok) throw new Error('E-mail desabilitado ou falha no envio');
    return { message: 'E-mail de teste enviado', to };
  }

  private async send(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        text,
        html: html ?? `<pre style="font-family:sans-serif">${text.replace(/\n/g, '<br>')}</pre>`,
      });
      this.logger.log(`E-mail enviado → ${to}: ${subject}`);
      return true;
    } catch (err) {
      this.logger.error(`Falha ao enviar para ${to}: ${(err as Error).message}`);
      return false;
    }
  }
}
