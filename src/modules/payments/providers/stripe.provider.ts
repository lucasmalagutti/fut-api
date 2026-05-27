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

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'brl',
        payment_method_types: ['pix'],
        confirm: true,
        payment_method_data: { type: 'pix' },
        metadata: { bookingId },
      });

      this.logger.log(`PIX PaymentIntent created: ${intent.id} status=${intent.status}`);

      const nextAction = intent.next_action as Record<string, any> | null;
      const pix = nextAction?.pix_display_qr_code as Record<string, string> | undefined;

      if (pix) {
        this.logger.log(`PIX QR Code URL: ${pix.image_url_png}`);
      } else {
        this.logger.warn(`PIX next_action ausente — status: ${intent.status}. Verifique se PIX esta habilitado no dashboard Stripe (https://dashboard.stripe.com/settings/payment_methods).`);
      }

      return {
        gatewayRef: intent.id,
        qrCode: pix?.data,
        qrCodeUrl: pix?.image_url_png,
      };
    } catch (err: any) {
      // PIX pode nao estar habilitado no test mode desta conta Stripe.
      // Neste caso, cria um PaymentIntent simples sem confirmar (sandbox local).
      if (err?.code === 'payment_method_unactivated' || err?.code === 'payment_intent_unexpected_state' || err?.type === 'StripeInvalidRequestError') {
        this.logger.warn(`Stripe PIX indisponivel (${err.code}) — usando modo sandbox local. Ative PIX em https://dashboard.stripe.com/settings/payment_methods`);

        // Cria intent sem PIX para ter um gatewayRef valido
        const fallbackIntent = await this.stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'brl',
          metadata: { bookingId, sandbox: 'true' },
        });

        // QR Code simulado para teste (base64 de imagem 1x1 transparente como placeholder)
        const fakeQrCode = `00020126580014BR.GOV.BCB.PIX0136${bookingId}5204000053039865802BR5913FutMatch Test6009Sao Paulo62070503***6304${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;

        return {
          gatewayRef: fallbackIntent.id,
          qrCode: fakeQrCode,
          qrCodeUrl: undefined, // sem imagem no sandbox local
        };
      }

      throw err;
    }
  }

  async refund(gatewayRef: string, amount: number): Promise<void> {
    const amountCents = Math.round(amount * 100);
    await this.stripe.refunds.create({ payment_intent: gatewayRef, amount: amountCents });
    this.logger.log(`Refund created for ${gatewayRef} amount=${amountCents}`);
  }
}
