import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CreateCustomerDto, VerifyOtpDto, PaginationQueryDto } from '../../common/dto';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new customer (generates QR)' })
  create(@Body() dto: CreateCustomerDto, @Request() req: any) {
    return this.customersService.create({
      ...dto,
      storeId: req.user.storeId,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List customers for store (paginated)' })
  findAll(@Request() req: any, @Query() query: PaginationQueryDto) {
    return this.customersService.findAll(req.user.storeId, query);
  }

  @Get('qr/:qrCode')
  @ApiOperation({ summary: 'Find customer by QR code (tenant-scoped)' })
  findByQr(@Param('qrCode') qrCode: string, @Request() req: any) {
    return this.customersService.findByQrCode(qrCode, req.user.storeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer details' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.customersService.findOneForStore(id, req.user.storeId);
  }

  @Post(':id/verify')
  @ApiOperation({ summary: 'Verify customer OTP' })
  verify(
    @Param('id') id: string,
    @Body() dto: VerifyOtpDto,
    @Request() req: any,
  ) {
    return this.customersService.verifyOtp(id, dto.otpCode, req.user.storeId);
  }

  // GDPR erasure (M302): admin-only + audited. Anonymises PII in place; never
  // hard-deletes and never touches a fiscal record (sales hold only customer_id).
  @Post(':id/anonymize')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Anonymise a customer (GDPR erasure — admin only, audited)' })
  anonymize(@Param('id') id: string, @Request() req: any) {
    return this.customersService.anonymize(id, req.user?.employeeId);
  }
}
