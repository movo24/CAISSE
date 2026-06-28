import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { BackofficeDiscountService } from './backoffice-discount.service';
import { AuthorizeBackofficeDiscountDto } from './dto/authorize-backoffice-discount.dto';

/**
 * POS-054e — Back-office discount endpoint. Admin-only, separate from the POS terminal.
 * Caisse terminals can never reach 100% (they use the POS sale path, hard-capped at 30%).
 */
@ApiTags('backoffice-discounts')
@ApiBearerAuth()
@Controller('backoffice/discounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackofficeDiscountController {
  constructor(private readonly service: BackofficeDiscountService) {}

  @Post('authorize')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Authorize a back-office discount (≤100%, admin only, motif + audit > 30%). Never available from a POS terminal.',
  })
  authorize(@Body() dto: AuthorizeBackofficeDiscountDto, @Req() req: any) {
    return this.service.authorize({
      storeId: dto.storeId ?? req.user.storeId,
      subtotalMinorUnits: dto.subtotalMinorUnits,
      discountMinorUnits: dto.discountMinorUnits,
      justification: dto.justification,
      actorEmployeeId: req.user.employeeId,
      actorRole: req.user.role,
    });
  }
}
