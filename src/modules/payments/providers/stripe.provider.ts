import { Injectable, Logger } from '@nestjs/common';
import StripeLib = require('stripe');
import { CheckoutResult, PaymentProvider } from './payment.interface';

type StripeInstance = StripeLib.Stripe;

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  private readonly stripe: StripeInstance;
  private readonly logger = new Logger(StripePaymentProvider.name);

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || key.startsWith('sk_test_COLOQUE')) {
      this.logger.warn('STRIPE_SECRET_KEY nao configurada. Configure o .env!');
    }
    this.stripe = new StripeLib(key ?? 'sk_test_placeholder');
  }

  async checkoutCard(bookingId: string, cardToken: string, amount: number): Promise<CheckoutResult> {
    const amountCents = Math.round(amount * 100);

    const intent = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'brl',
      payment_method: cardToken,
      payment_method_types: ['card'],
      confirm: true,
      metadata: { bookingId },
      return_url: 'futmatch://payment/return',
    });

    this.logger.log(`Card PaymentIntent created: ${intent.id} status=${intent.status}`);
    return { gatewayRef: intent.id };
  }

  async checkoutPix(bookingId: string, amount: number): Promise<CheckoutResult> {
    const amountCents = Math.round(amount * 100);

    const intent = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'brl',
      payment_method_types: ['pix'],
      payment_method_data: { type: 'pix' },
      confirm: true,
      metadata: { bookingId },
    });

    this.logger.log(`PIX PaymentIntent created: ${intent.id} status=${intent.status}`);

    const nextAction = intent.next_action as Record<string, any> | null;
    const pix = nextAction?.pix_display_qr_code as Record<string, string> | undefined;

    return {
      gatewayRef: intent.id,
      qrCode: pix?.data,
      qrCodeUrl: pix?.image_url_png,
    };
  }

  async refund(gatewayRef: string, amount: number): Promise<void> {
    const amountCents = Math.round(amount * 100);
    await this.stripe.refunds.create({ payment_intent: gatewayRef, amount: amountCents });
    this.logger.log(`Refund created for ${gatewayRef} amount=${amountCents}`);
  }
}
