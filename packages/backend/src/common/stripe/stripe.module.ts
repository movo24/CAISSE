import { Global, Module, Logger } from '@nestjs/common';
import Stripe from 'stripe';

const STRIPE_PROVIDER = {
  provide: 'STRIPE',
  useFactory: (): Stripe => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      new Logger('StripeModule').warn(
        'STRIPE_SECRET_KEY not set — Stripe features disabled.',
      );
      return null as any;
    }
    return new Stripe(key, { apiVersion: '2025-02-24.acacia' as any });
  },
};

@Global()
@Module({
  providers: [STRIPE_PROVIDER],
  exports: [STRIPE_PROVIDER],
})
export class StripeModule {}
