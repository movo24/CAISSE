import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CustomerVisitsService } from './customer-visits.service';

/**
 * POS-094 — Customer visit frequency (read-only). Fail-closed: JwtAuthGuard + RolesGuard
 * (manager/admin) + anti-IDOR ownership check in the service (customer must belong to the
 * caller's store; admin bypass).
 */
@ApiTags('customer-visits')
@ApiBearerAuth()
@Controller('customer-visits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerVisitsController {
  constructor(private readonly service: CustomerVisitsService) {}

  @Get(':customerId/frequency')
  @Roles('manager')
  @ApiOperation({ summary: 'Visit frequency for a customer (manager/admin, own store only)' })
  getFrequency(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Req() req: any,
  ) {
    return this.service.getFrequencySecured(customerId, req.user.storeId, req.user.role);
  }
}
