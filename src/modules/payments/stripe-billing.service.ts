import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import StripeLib = require('stripe');
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
    this.stripe = new StripeLib(this.config.get('STRIPE_SECRET_KEY') ?? 'sk_test_placeholder');
  }

  getClient(): StripeLib.Stripe {
    return this.stripe;
  }

  async ensureCustomer(user: User): Promise<string> {
    if (user.stripeCustomerId) return user.stripeCustomerId;

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
    const customerId = await this.ensureCustomer(user);
    const pm = await this.stripe.paymentMethods.create({
      type: 'card',
      card: { token: 'tok_visa' },
    });
    await this.stripe.paymentMethods.attach(pm.id, { customer: customerId });
    return pm;
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
    const amountCents = Math.round(amount * 100);
    const refId = meta.participantId ?? meta.bookingId ?? meta.userId;

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
        qrCodeUrl: pix?.image_url_png,
      };
    } catch (err: any) {
      if (
        err?.code === 'payment_method_unactivated' ||
        err?.code === 'payment_intent_unexpected_state' ||
        err?.type === 'StripeInvalidRequestError'
      ) {
        this.logger.warn(`PIX indisponivel — sandbox local (${err.code})`);
        const fallbackIntent = await this.stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'brl',
          metadata: { ...this.metaToStripe(meta), sandbox: 'true' },
        });
        const fakeQrCode = `00020126580014BR.GOV.BCB.PIX0136${refId}5204000053039865802BR5913FutMatch6009Sao Paulo62070503***6304${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
        return { gatewayRef: fallbackIntent.id, qrCode: fakeQrCode, qrCodeUrl: undefined };
      }
      throw err;
    }
  }
}
