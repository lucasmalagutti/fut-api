export interface CheckoutResult {
  gatewayRef: string;
  qrCode?: string;
}

export interface PaymentProvider {
  checkoutCard(bookingId: string, cardToken: string, amount: number): Promise<CheckoutResult>;
  checkoutPix(bookingId: string, amount: number): Promise<CheckoutResult>;
  refund(gatewayRef: string, amount: number): Promise<void>;
}
