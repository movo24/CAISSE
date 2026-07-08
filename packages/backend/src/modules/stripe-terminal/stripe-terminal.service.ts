import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { createHash } from 'crypto';

@Injectable()
export class StripeTerminalService {
  private readonly logger = new Logger(StripeTerminalService.name);

  constructor(@Inject('STRIPE') private readonly stripe: Stripe) {}

  // ── Capability ────────────────────────────────────────────────

  /**
   * Whether real card-present payments are possible (STRIPE_SECRET_KEY set).
   * The POS uses this to disable the card button (prod) or fall back to an
   * explicit demo mode (dev) instead of faking a payment.
   */
  isConfigured(): boolean {
    return !!this.stripe;
  }

  // ── Connection Token ──────────────────────────────────────────

  async createConnectionToken(locationId?: string): Promise<{ secret: string }> {
    this.assertStripe();

    const params: Stripe.Terminal.ConnectionTokenCreateParams = {};
    if (locationId) {
      params.location = locationId;
    }

    const token = await this.stripe.terminal.connectionTokens.create(params);
    this.logger.log(`Connection token created${locationId ? ` for location ${locationId}` : ''}`);
    return { secret: token.secret };
  }

  // ── PaymentIntent ─────────────────────────────────────────────

  async createPaymentIntent(
    amount: number,
    currency: string,
    storeId: string,
    ticketNumber: string,
    employeeId?: string,
    description?: string,
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    this.assertStripe();

    // Idempotency key: prevents double charge on network retry
    // DETERMINISTIC — same inputs always produce the same key
    // A retry with identical (store, ticket, amount, currency, employee) reuses the same PaymentIntent
    const idempotencyKey = createHash('sha256')
      .update(`${storeId}:${ticketNumber}:${amount}:${currency}:${employeeId || ''}`)
      .digest('hex');

    const pi = await this.stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        description: description || `CAISSE POS — ${ticketNumber}`,
        metadata: {
          storeId,
          ticketNumber,
          employeeId: employeeId || 'unknown',
          source: 'caisse_pos_terminal',
        },
      },
      { idempotencyKey },
    );

    this.logger.log(
      `[PAYMENT] PaymentIntent created: ${pi.id} — ${amount / 100} ${currency.toUpperCase()} — ticket ${ticketNumber} — employee ${employeeId || 'unknown'}`,
    );

    return { clientSecret: pi.client_secret!, paymentIntentId: pi.id };
  }

  async getPaymentIntent(
    paymentIntentId: string,
    storeId: string,
  ): Promise<{
    id: string;
    status: string;
    amount: number;
    currency: string;
    readerId?: string;
  }> {
    this.assertStripe();
    const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);

    if (pi.metadata.storeId !== storeId) {
      this.logger.warn(`[SECURITY] Store ${storeId} tried to access PI ${paymentIntentId} owned by ${pi.metadata.storeId}`);
      throw new BadRequestException('PaymentIntent does not belong to this store.');
    }

    return {
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
      readerId: (pi as any).latest_charge?.payment_method_details?.card_present?.reader || undefined,
    };
  }

  async cancelPaymentIntent(
    paymentIntentId: string,
    storeId: string,
  ): Promise<{ id: string; status: string }> {
    this.assertStripe();

    const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.metadata.storeId !== storeId) {
      throw new BadRequestException('PaymentIntent does not belong to this store.');
    }

    const cancelled = await this.stripe.paymentIntents.cancel(paymentIntentId);
    this.logger.log(`[PAYMENT] PaymentIntent cancelled: ${cancelled.id}`);
    return { id: cancelled.id, status: cancelled.status };
  }

  // ── Locations ─────────────────────────────────────────────────

  async listLocations(): Promise<Stripe.Terminal.Location[]> {
    this.assertStripe();
    const result = await this.stripe.terminal.locations.list({ limit: 100 });
    return result.data;
  }

  async createLocation(
    displayName: string,
    country = 'FR',
  ): Promise<{ id: string; display_name: string }> {
    this.assertStripe();

    const location = await this.stripe.terminal.locations.create({
      display_name: displayName,
      address: { country, line1: 'N/A', city: 'N/A', postal_code: '00000' },
    });

    this.logger.log(`[LOCATION] Created: ${location.id} — ${displayName}`);
    return { id: location.id, display_name: location.display_name };
  }

  // ── Readers ───────────────────────────────────────────────────

  async listReaders(locationId?: string): Promise<Stripe.Terminal.Reader[]> {
    this.assertStripe();

    const params: Stripe.Terminal.ReaderListParams = { limit: 100 };
    if (locationId) params.location = locationId;

    const result = await this.stripe.terminal.readers.list(params);
    return result.data;
  }

  async registerReader(
    registrationCode: string,
    label: string,
    locationId: string,
  ): Promise<{ id: string; label: string; status: string; deviceType: string }> {
    this.assertStripe();

    const reader = await this.stripe.terminal.readers.create({
      registration_code: registrationCode,
      label,
      location: locationId,
    });

    this.logger.log(`[READER] Registered: ${reader.id} — ${label} — ${reader.device_type}`);

    return {
      id: reader.id,
      label: reader.label || label,
      status: reader.status || 'online',
      deviceType: reader.device_type,
    };
  }

  // ── Guard ─────────────────────────────────────────────────────

  private assertStripe(): void {
    if (!this.stripe) {
      throw new BadRequestException('Stripe not configured. Set STRIPE_SECRET_KEY.');
    }
  }
}
