import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StripeTerminalService } from './stripe-terminal.service';
import {
  CreateTerminalPaymentIntentDto,
} from '../../common/dto';
import { BusinessError } from '../../common/errors/business-error';

@ApiTags('stripe-terminal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stripe-terminal')
export class StripeTerminalController {
  constructor(private terminalService: StripeTerminalService) {}

  /**
   * POST /api/stripe-terminal/connection-token
   * Returns a short-lived token for the Stripe Terminal JS SDK.
   */
  @Post('connection-token')
  @ApiOperation({ summary: 'Get Stripe Terminal connection token for POS reader' })
  async getConnectionToken() {
    return this.terminalService.createConnectionToken();
  }

  /**
   * POST /api/stripe-terminal/payment-intent
   * Create a PaymentIntent for a card-present transaction.
   */
  @Post('payment-intent')
  @ApiOperation({ summary: 'Create PaymentIntent for in-store card payment' })
  async createPaymentIntent(
    @Request() req: any,
    @Body() dto: CreateTerminalPaymentIntentDto,
  ) {
    const storeId = req.user?.storeId;
    if (!storeId) {
      throw BusinessError.invalidRelation('Aucun magasin selectionne.');
    }

    // Use store's currency or default EUR
    const currency = dto.currency || 'EUR';

    return this.terminalService.createPaymentIntent(
      dto.amount,
      currency,
      storeId,
      dto.ticketNumber,
      dto.description,
    );
  }

  /**
   * GET /api/stripe-terminal/payment-intent/:id
   * Check status of a PaymentIntent.
   */
  @Get('payment-intent/:id')
  @ApiOperation({ summary: 'Get PaymentIntent status' })
  async getPaymentIntent(
    @Request() req: any,
    @Param('id') paymentIntentId: string,
  ) {
    return this.terminalService.getPaymentIntent(
      paymentIntentId,
      req.user.storeId,
    );
  }

  /**
   * POST /api/stripe-terminal/payment-intent/:id/cancel
   * Cancel a PaymentIntent (customer cancelled at reader).
   */
  @Post('payment-intent/:id/cancel')
  @ApiOperation({ summary: 'Cancel a PaymentIntent' })
  async cancelPaymentIntent(
    @Request() req: any,
    @Param('id') paymentIntentId: string,
  ) {
    return this.terminalService.cancelPaymentIntent(
      paymentIntentId,
      req.user.storeId,
    );
  }
}
