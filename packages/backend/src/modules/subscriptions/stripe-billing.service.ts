import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { SubscriptionEntity } from '../../database/entities/subscription.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { PLAN_CATALOG } from './subscriptions.service';

/**
 * Stripe Billing Service — handles Checkout Sessions, Customer Portal,
 * and Webhook events for SaaS subscription management.
 *
 * Price IDs should be created in Stripe Dashboard and mapped here.
 * For MVP, we create prices on-the-fly from PLAN_CATALOG.
 */
@Injectable()
export class StripeBillingService {
  private readonly logger = new Logger(StripeBillingService.name);
  private readonly processedEvents = new Set<string>();

  constructor(
    @Inject('STRIPE') private readonly stripe: Stripe,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
    @InjectRepository(StoreEntity)
    private readonly storeRepo: Repository<StoreEntity>,
  ) {}

  /**
   * Create a Stripe Checkout Session for a subscription upgrade.
   * Redirects the store admin to Stripe's hosted checkout page.
   */
  async createCheckoutSession(
    storeId: string,
    plan: string,
    billingCycle: 'monthly' | 'yearly',
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string; sessionId: string }> {
    this.assertStripeConfigured();

    const planDef = PLAN_CATALOG[plan];
    if (!planDef) throw new BadRequestException(`Unknown plan: ${plan}`);

    const price =
      billingCycle === 'yearly'
        ? planDef.priceYearlyMinorUnits
        : planDef.priceMonthlyMinorUnits;

    if (price === 0) throw new BadRequestException('Cannot checkout free plan via Stripe.');

    // Get or create Stripe customer
    const sub = await this.subRepo.findOne({ where: { storeId } });
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    let customerId = sub?.stripeCustomerId;

    if (!customerId) {
      const customer = await this.stripe.customers.create({
        name: store?.name || `Store ${storeId}`,
        email: store?.email || undefined,
        metadata: { storeId, plan },
      });
      customerId = customer.id;

      // Persist Stripe customer ID
      if (sub) {
        sub.stripeCustomerId = customerId;
        await this.subRepo.save(sub);
      }
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `CAISSE ${planDef.name}`,
              description: `Plan ${planDef.name} — ${billingCycle === 'yearly' ? 'annuel' : 'mensuel'}`,
            },
            unit_amount: price,
            recurring: {
              interval: billingCycle === 'yearly' ? 'year' : 'month',
            },
          },
          quantity: 1,
        },
      ],
      metadata: { storeId, plan, billingCycle },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    this.logger.log(
      `Checkout session created: ${session.id} — ${plan} ${billingCycle} for store ${storeId}`,
    );

    return { url: session.url!, sessionId: session.id };
  }

  /**
   * Create a Stripe Customer Portal session.
   * Allows the store admin to manage their subscription, update payment method, etc.
   */
  async createPortalSession(
    storeId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    this.assertStripeConfigured();

    const sub = await this.subRepo.findOne({ where: { storeId } });
    if (!sub?.stripeCustomerId) {
      throw new BadRequestException('No Stripe customer found for this store.');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  /**
   * Handle Stripe webhook events.
   * Must be called from a controller with the raw body for signature verification.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    this.assertStripeConfigured();

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET not set — rejecting webhook for security');
      throw new Error('Webhook secret not configured — cannot verify signature');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (err: any) {
      this.logger.error(`Webhook signature verification failed: ${err.message}`);
      throw new BadRequestException('Invalid webhook signature.');
    }

    this.logger.log(`Stripe webhook received: ${event.type} (${event.id})`);

    // Deduplicate: skip already-processed events (Stripe can retry)
    const eventCacheKey = `stripe_event:${event.id}`;
    const alreadyProcessed = this.processedEvents.has(event.id);
    if (alreadyProcessed) {
      this.logger.log(`Webhook event ${event.id} already processed — skipping`);
      return;
    }
    this.processedEvents.add(event.id);
    // Cleanup old events (keep last 1000)
    if (this.processedEvents.size > 1000) {
      const entries = Array.from(this.processedEvents);
      entries.slice(0, entries.length - 1000).forEach((e) => this.processedEvents.delete(e));
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_action_required':
        this.logger.warn(
          `Payment action required for invoice ${(event.data.object as Stripe.Invoice).id} — customer must complete authentication`,
        );
        break;

      case 'customer.subscription.trial_will_end':
        this.logger.log(
          `Trial ending soon for subscription ${(event.data.object as Stripe.Subscription).id}`,
        );
        break;

      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }
  }

  // -----------------------------------------------------------------------
  // Webhook handlers
  // -----------------------------------------------------------------------

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const storeId = session.metadata?.storeId;
    const plan = session.metadata?.plan;
    const billingCycle = session.metadata?.billingCycle as 'monthly' | 'yearly';

    if (!storeId || !plan) {
      this.logger.warn('Checkout completed but missing metadata');
      return;
    }

    const sub = await this.subRepo.findOne({ where: { storeId } });
    if (!sub) {
      this.logger.warn(`No subscription found for store ${storeId}`);
      return;
    }

    const planDef = PLAN_CATALOG[plan];
    if (!planDef) return;

    const price =
      billingCycle === 'yearly'
        ? planDef.priceYearlyMinorUnits
        : planDef.priceMonthlyMinorUnits;

    // Update subscription to active with Stripe IDs
    sub.plan = plan as any;
    sub.status = 'active';
    sub.priceMinorUnits = price;
    sub.billingCycle = billingCycle || 'monthly';
    sub.stripeCustomerId = session.customer as string;
    sub.stripeSubscriptionId = (session as any).subscription as string;
    sub.maxTerminals = planDef.maxTerminals;
    sub.maxProducts = planDef.maxProducts;
    sub.maxEmployees = planDef.maxEmployees;
    sub.featuresEnabled = planDef.features;

    const now = new Date();
    sub.currentPeriodStart = now;
    const periodEnd = new Date(now);
    if (billingCycle === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }
    sub.currentPeriodEnd = periodEnd;

    await this.subRepo.save(sub);

    this.logger.log(
      `Subscription activated via Stripe: store ${storeId} → ${plan} (${billingCycle})`,
    );
  }

  private async handleSubscriptionUpdated(stripeSub: Stripe.Subscription): Promise<void> {
    const sub = await this.subRepo.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (!sub) return;

    // Update period dates from Stripe subscription items
    const subAny = stripeSub as any;
    if (subAny.current_period_start) {
      sub.currentPeriodStart = new Date(subAny.current_period_start * 1000);
    }
    if (subAny.current_period_end) {
      sub.currentPeriodEnd = new Date(subAny.current_period_end * 1000);
    }

    if (stripeSub.status === 'active') {
      sub.status = 'active';
    } else if (stripeSub.status === 'past_due') {
      sub.status = 'past_due';
    } else if (stripeSub.status === 'canceled') {
      sub.status = 'cancelled';
      sub.cancelledAt = new Date();
    }

    await this.subRepo.save(sub);
    this.logger.log(`Subscription updated: ${sub.storeId} → ${stripeSub.status}`);
  }

  private async handleSubscriptionDeleted(stripeSub: Stripe.Subscription): Promise<void> {
    const sub = await this.subRepo.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (!sub) return;

    sub.status = 'cancelled';
    sub.cancelledAt = new Date();
    await this.subRepo.save(sub);

    this.logger.log(`Subscription cancelled via Stripe: ${sub.storeId}`);
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string;
    const sub = await this.subRepo.findOne({
      where: { stripeCustomerId: customerId },
    });
    if (!sub) return;

    sub.status = 'past_due';
    await this.subRepo.save(sub);

    this.logger.warn(`Payment failed for store ${sub.storeId} — marked past_due`);
  }

  private assertStripeConfigured(): void {
    if (!this.stripe) {
      throw new BadRequestException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY in environment.',
      );
    }
  }
}
