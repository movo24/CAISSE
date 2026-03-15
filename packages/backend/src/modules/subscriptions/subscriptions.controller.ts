import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
} from '@nestjs/swagger';
import { SkipTenantCheck } from '../../common/interceptors/tenant.interceptor';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // Public: get available plans (no auth, no tenant check)
  @Get('plans')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'Get all available subscription plans and pricing' })
  getPlans() {
    return this.subscriptionsService.getPlans();
  }

  // Protected: store-specific operations
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':storeId')
  @ApiOperation({ summary: 'Get subscription details for a store' })
  async getSubscription(@Param('storeId') storeId: string) {
    return this.subscriptionsService.getByStoreId(storeId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':storeId/usage')
  @ApiOperation({
    summary: 'Get usage stats (products, employees, features) vs plan limits',
  })
  async getUsage(@Param('storeId') storeId: string) {
    return this.subscriptionsService.getUsage(storeId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':storeId/change-plan')
  @ApiOperation({ summary: 'Upgrade or downgrade subscription plan' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        plan: {
          type: 'string',
          enum: ['starter', 'business', 'enterprise'],
        },
        billingCycle: {
          type: 'string',
          enum: ['monthly', 'yearly'],
        },
      },
    },
  })
  async changePlan(
    @Param('storeId') storeId: string,
    @Body() body: { plan: string; billingCycle?: 'monthly' | 'yearly' },
  ) {
    return this.subscriptionsService.changePlan(
      storeId,
      body.plan,
      body.billingCycle || 'monthly',
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':storeId/cancel')
  @ApiOperation({
    summary: 'Cancel subscription (access until end of current period)',
  })
  async cancel(@Param('storeId') storeId: string) {
    return this.subscriptionsService.cancel(storeId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':storeId/trial')
  @ApiOperation({ summary: 'Create a 14-day trial subscription for a new store' })
  async createTrial(@Param('storeId') storeId: string) {
    return this.subscriptionsService.createTrialForStore(storeId);
  }
}
