import { Module } from '@nestjs/common';
import { FiscalVerifyService } from './fiscal-verify.service';

/**
 * Fiscal tooling — read-only chain verification (see FiscalVerifyService).
 * Provided/exported so a controller or scheduled job can consume it later.
 */
@Module({
  providers: [FiscalVerifyService],
  exports: [FiscalVerifyService],
})
export class FiscalModule {}
