import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import StripeLib = require('stripe');
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckoutResult } from './providers/payment.interface';

export type StripePaymentMeta = {
  purpose: 'booking_host' | 'participant_quota' | 'wallet_topup';
  userId: string;
  bookingId?: string;
  participantId?: string;
};

@Injectable()
export class StripeBillingService {
  private readonly logger = new Logger(StripeBillingService.name);
  private readonly stripe: StripeLib.Stripe;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const key = this.config.get('STRIPE_SECRET_KEY') ?? '';
    this.stripe = new StripeLib(key || 'sk_test_placeholder');
    if (this.isMockMode()) {
      this.logger.warn(
        'STRIPE_SECRET_KEY ausente ou placeholder — cartões e PIX usam modo sandbox local.',
      );
    }
  }

  private isMockMode(): boolean {
    const key = this.config.get('STRIPE_SECRET_KEY') ?? '';
    return (
      !key ||
      key === 'sk_test_placeholder' ||
      key.includes('placeholder') ||
      key.startsWith('sk_test_COLOQUE')
    );
  }

  private isStripeFallbackError(err: unknown): boolean {
    const e = err as { type?: string; code?: string };
    return (
      e?.type === 'StripeAuthenticationError' ||
      e?.type === 'StripeInvalidRequestError' ||
      e?.code === 'payment_method_unactivated' ||
      e?.code === 'payment_intent_unexpected_state'
    );
  }

  private mockPixCheckout(meta: StripePaymentMeta, amount: number): CheckoutResult {
    const refId = meta.participantId ?? meta.bookingId ?? meta.userId;
    const gatewayRef = `mock_pix_${uuidv4()}`;
    const fakeQrCode = `00020126580014BR.GOV.BCB.PIX0136${refId}520400005303986540${amount.toFixed(2)}5802BR5913FutMatch6009Sao Paulo62070503***6304${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
    return {
      gatewayRef,
      qrCode: fakeQrCode,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(fakeQrCode)}`,
    };
  }

  private mockTestPaymentMethod() {
    const year = new Date().getFullYear() + 3;
    return {
      id: `pm_mock_${uuidv4()}`,
      type: 'card' as const,
      card: {
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: year,
      },
    };
  }

  getClient(): StripeLib.Stripe {
    return this.stripe;
  }

  async ensureCustomer(user: User): Promise<string> {
    if (user.stripeCustomerId) return user.stripeCustomerId;

    if (this.isMockMode()) {
      const mockId = `mock_cus_${user.id}`;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: mockId },
      });
      return mockId;
    }

    const customer = await this.stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  async createSetupIntent(user: User) {
    const customerId = await this.ensureCustomer(user);
    const intent = await this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      metadata: { userId: user.id },
    });
    return { clientSecret: intent.client_secret, customerId };
  }

  /** Cartão de teste Visa (4242) — só modo test do Stripe */
  async attachTestCard(user: User) {
    if (this.isMockMode()) {
      this.logger.log(`Mock attachTestCard para ${user.email}`);
      return this.mockTestPaymentMethod();
    }

    try {
      const customerId = await this.ensureCustomer(user);
      const pm = await this.stripe.paymentMethods.create({
        type: 'card',
        card: { token: 'tok_visa' },
      });
      await this.stripe.paymentMethods.attach(pm.id, { customer: customerId });
      return pm;
    } catch (err) {
      if (this.isStripeFallbackError(err)) {
        this.logger.warn('Stripe indisponível — usando cartão mock local');
        return this.mockTestPaymentMethod();
      }
      throw err;
    }
  }

  async attachPaymentMethod(user: User, paymentMethodId: string) {
    const customerId = await this.ensureCustomer(user);
    await this.stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    const pm = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.type !== 'card' || !pm.card) {
      throw new Error('Payment method is not a card');
    }

    const existing = await this.prisma.card.count({ where: { userId: user.id } });
    const isDefault = existing === 0;

    if (isDefault) {
      await this.prisma.card.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    }

    return this.prisma.card.create({
      data: {
        userId: user.id,
        providerToken: paymentMethodId,
        brand: pm.card.brand,
        last4: pm.card.last4,
        holderName: user.name,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        isDefault,
      },
    });
  }

  async setDefaultCard(userId: string, cardId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.userId !== userId) throw new Error('Card not found');
    await this.prisma.$transaction([
      this.prisma.card.updateMany({ where: { userId }, data: { isDefault: false } }),
      this.prisma.card.update({ where: { id: cardId }, data: { isDefault: true } }),
    ]);
    return this.prisma.card.findUnique({ where: { id: cardId } });
  }

  private metaToStripe(meta: StripePaymentMeta): Record<string, string> {
    return {
      purpose: meta.purpose,
      userId: meta.userId,
      ...(meta.bookingId && { bookingId: meta.bookingId }),
      ...(meta.participantId && { participantId: meta.participantId }),
    };
  }

  async checkoutCard(meta: StripePaymentMeta, paymentMethodId: string, amount: number): Promise<CheckoutResult> {
    const amountCents = Math.round(amount * 100);
    const user = await this.prisma.user.findUnique({
      where: { id: meta.userId },
      select: { stripeCustomerId: true },
    });
    const intent = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'brl',
      ...(user?.stripeCustomerId ? { customer: user.stripeCustomerId } : {}),
      payment_method: paymentMethodId,
      payment_method_types: ['card'],
      confirm: true,
      metadata: this.metaToStripe(meta),
      return_url: 'futmatch://payment/return',
    });
    this.logger.log(`Card PI ${intent.id} status=${intent.status}`);
    return { gatewayRef: intent.id };
  }

  async checkoutPix(meta: StripePaymentMeta, amount: number): Promise<CheckoutResult> {
    if (this.isMockMode()) {
      this.logger.log(`Mock PIX top-up R$${amount} para user ${meta.userId}`);
      return this.mockPixCheckout(meta, amount);
    }

    const amountCents = Math.round(amount * 100);

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'brl',
        payment_method_types: ['pix'],
        confirm: true,
        payment_method_data: { type: 'pix' },
        metadata: this.metaToStripe(meta),
      });

      const nextAction = intent.next_action as Record<string, any> | null;
      const pix = nextAction?.pix_display_qr_code as Record<string, string> | undefined;

      return {
        gatewayRef: intent.id,
        qrCode: pix?.data,
        qrCodeUrl:
          pix?.image_url_png ??
          (pix?.data
            ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(pix.data)}`
            : undefined),
      };
    } catch (err: unknown) {
      if (this.isStripeFallbackError(err)) {
        const code = (err as { code?: string }).code;
        this.logger.warn(`PIX indisponível (${code ?? 'stripe'}) — sandbox local`);
        return this.mockPixCheckout(meta, amount);
      }
      throw err;
    }
  }
}
