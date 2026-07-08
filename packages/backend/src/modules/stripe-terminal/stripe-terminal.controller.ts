import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { StripeTerminalService } from './stripe-terminal.service';
import { CreateTerminalPaymentIntentDto } from '../../common/dto';
import { BusinessError } from '../../common/errors/business-error';

@ApiTags('stripe-terminal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stripe-terminal')
export class StripeTerminalController {
  constructor(private terminalService: StripeTerminalService) {}

  // ── Capability ────────────────────────────────────────────────

  @Get('status')
  @ApiOperation({ summary: 'Whether Stripe Terminal (card-present) is configured on this backend' })
  getStatus() {
    return { configured: this.terminalService.isConfigured() };
  }

  // ── Connection Token ──────────────────────────────────────────

  @Post('connection-token')
  @ApiOperation({ summary: 'Get Stripe Terminal connection token' })
  async getConnectionToken(@Request() req: any) {
    const locationId = req.body?.locationId;
    return this.terminalService.createConnectionToken(locationId);
  }

  // ── PaymentIntent CRUD ────────────────────────────────────────

  @Post('payment-intent')
  @ApiOperation({ summary: 'Create PaymentIntent for card-present payment' })
  async createPaymentIntent(
    @Request() req: any,
    @Body() dto: CreateTerminalPaymentIntentDto,
  ) {
    const storeId = req.user?.storeId;
    if (!storeId) {
      throw BusinessError.invalidRelation('Aucun magasin selectionne.');
    }

    return this.terminalService.createPaymentIntent(
      dto.amount,
      dto.currency || 'EUR',
      storeId,
      dto.ticketNumber,
      req.user.employeeId,
      dto.description,
    );
  }

  @Get('payment-intent/:id')
  @ApiOperation({ summary: 'Get PaymentIntent status' })
  async getPaymentIntent(
    @Request() req: any,
    @Param('id') paymentIntentId: string,
  ) {
    return this.terminalService.getPaymentIntent(paymentIntentId, req.user.storeId);
  }

  @Post('payment-intent/:id/cancel')
  @ApiOperation({ summary: 'Cancel PaymentIntent' })
  async cancelPaymentIntent(
    @Request() req: any,
    @Param('id') paymentIntentId: string,
  ) {
    return this.terminalService.cancelPaymentIntent(paymentIntentId, req.user.storeId);
  }

  // ── Locations ─────────────────────────────────────────────────

  @Get('locations')
  @ApiOperation({ summary: 'List Stripe Terminal locations' })
  async listLocations() {
    return this.terminalService.listLocations();
  }

  // ── Readers ───────────────────────────────────────────────────

  @Get('readers')
  @ApiOperation({ summary: 'List readers for a location' })
  async listReaders(@Query('locationId') locationId?: string) {
    return this.terminalService.listReaders(locationId);
  }

  @Post('readers/register')
  @Roles('admin')
  @ApiOperation({ summary: 'Register a new physical reader' })
  async registerReader(
    @Body() body: { registrationCode: string; label: string; locationId: string },
  ) {
    return this.terminalService.registerReader(
      body.registrationCode,
      body.label,
      body.locationId,
    );
  }
}
