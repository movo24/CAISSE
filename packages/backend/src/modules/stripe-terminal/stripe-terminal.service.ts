import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeTerminalService {
  private readonly logger = new Logger(StripeTerminalService.name);

  constructor(@Inject('STRIPE') private readonly stripe: Stripe) {}

  /**
   * Create a connection token for the Stripe Terminal JS SDK.
   * Called by the POS frontend to initialize the reader connection.
   * Each token is short-lived and scoped to the terminal session.
   */
  async createConnectionToken(): Promise<{ secret: string }> {
    this.assertStripeConfigured();

    const token = await this.stripe.terminal.connectionTokens.create();
    return { secret: token.secret };
  }

  /**
   * Create a PaymentIntent for an in-store card payment.
   * The POS collects the payment via Stripe Terminal SDK,
   * then we confirm/capture on the backend.
   */
  async createPaymentIntent(
    amount: number,
    currency: string,
    storeId: string,
    ticketNumber: string,
    description?: string,
  ): Promise<{
    clientSecret: string;
    paymentIntentId: string;
  }> {
    this.assertStripeConfigured();

    const pi = await this.stripe.paymentIntents.create({
      amount,
      currency: currency.toLowerCase(),
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      description: description || `CAISSE POS — ${ticketNumber}`,
      metadata: {
        storeId,
        ticketNumber,
        source: 'caisse_pos_terminal',
      },
    });

    this.logger.log(
      `PaymentIntent created: ${pi.id} — ${amount / 100} ${currency} — ticket ${ticketNumber}`,
    );

    return {
      clientSecret: pi.client_secret!,
      paymentIntentId: pi.id,
    };
  }

  /**
   * Retrieve a PaymentIntent status.
   * Used by the POS to poll/confirm payment status after reader interaction.
   */
  async getPaymentIntent(
    paymentIntentId: string,
    storeId: string,
  ): Promise<{
    id: string;
    status: string;
    amount: number;
    currency: string;
  }> {
    this.assertStripeConfigured();

    const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);

    // Tenant check: only the store that created the PI can read it
    if (pi.metadata.storeId !== storeId) {
      throw new BadRequestException('PaymentIntent does not belong to this store.');
    }

    return {
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
    };
  }

  /**
   * Cancel a PaymentIntent (e.g., customer cancelled at the reader).
   */
  async cancelPaymentIntent(
    paymentIntentId: string,
    storeId: string,
  ): Promise<{ id: string; status: string }> {
    this.assertStripeConfigured();

    // Verify ownership
    const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.metadata.storeId !== storeId) {
      throw new BadRequestException('PaymentIntent does not belong to this store.');
    }

    const cancelled = await this.stripe.paymentIntents.cancel(paymentIntentId);

    this.logger.log(`PaymentIntent cancelled: ${cancelled.id}`);

    return { id: cancelled.id, status: cancelled.status };
  }

  private assertStripeConfigured(): void {
    if (!this.stripe) {
      throw new BadRequestException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY in environment.',
      );
    }
  }
}
