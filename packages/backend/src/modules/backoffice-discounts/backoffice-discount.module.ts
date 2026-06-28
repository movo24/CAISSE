import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BackofficeDiscountController } from './backoffice-discount.controller';
import { BackofficeDiscountService } from './backoffice-discount.service';

/**
 * POS-054e — Back-office discount module (admin-only, separate from POS caisse).
 */
@Module({
  imports: [AuditModule],
  controllers: [BackofficeDiscountController],
  providers: [BackofficeDiscountService],
  exports: [BackofficeDiscountService],
})
export class BackofficeDiscountModule {}
