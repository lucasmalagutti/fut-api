import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CheckoutResult, PaymentProvider } from './payment.interface';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  async checkoutCard(_bookingId: string, _cardToken: string, _amount: number): Promise<CheckoutResult> {
    return { gatewayRef: `mock_card_${uuidv4()}` };
  }

  async checkoutPix(_bookingId: string, _amount: number): Promise<CheckoutResult> {
    const ref = `mock_pix_${uuidv4()}`;
    return {
      gatewayRef: ref,
      qrCode: `00020126360014BR.GOV.BCB.PIX${ref}520400005303986540${_amount.toFixed(2)}5802BR6009SAO PAULO62070503***6304ABCD`,
    };
  }

  async refund(_gatewayRef: string, _amount: number): Promise<void> {
    // mock: always succeeds
  }
}
