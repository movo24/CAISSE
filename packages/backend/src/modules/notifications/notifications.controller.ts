import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Get full notification summary (loyalty + stock)',
    description:
      'Returns loyalty reminders for inactive customers and stock alerts ' +
      'for a given store.',
  })
  @ApiQuery({ name: 'storeId', required: true })
  @ApiQuery({
    name: 'inactiveDays',
    required: false,
    description: 'Days of inactivity to trigger loyalty reminder (default: 30)',
  })
  async getSummary(
    @Query('storeId') storeId: string,
    @Query('inactiveDays') inactiveDays?: string,
  ) {
    return this.notificationsService.getNotificationSummary(
      storeId,
      inactiveDays ? parseInt(inactiveDays) : 30,
    );
  }

  @Get('loyalty-reminders')
  @ApiOperation({
    summary: 'Get QR loyalty reminders for inactive customers',
  })
  @ApiQuery({ name: 'storeId', required: true })
  @ApiQuery({ name: 'inactiveDays', required: false })
  async getLoyaltyReminders(
    @Query('storeId') storeId: string,
    @Query('inactiveDays') inactiveDays?: string,
  ) {
    return this.notificationsService.getLoyaltyReminders(
      storeId,
      inactiveDays ? parseInt(inactiveDays) : 30,
    );
  }

  @Get('stock-alerts')
  @ApiOperation({
    summary: 'Get stock notifications for products below thresholds',
  })
  @ApiQuery({ name: 'storeId', required: true })
  async getStockAlerts(@Query('storeId') storeId: string) {
    return this.notificationsService.getStockNotifications(storeId);
  }

  @Post('send-qr-reminder/:customerId')
  @ApiOperation({
    summary: 'Generate and send a QR loyalty reminder to a customer',
    description:
      'MVP: Logs the message to console. V1: Will send via SMS/email.',
  })
  async sendQrReminder(
    @Param('customerId') customerId: string,
    @Query('storeId') storeId: string,
  ) {
    return this.notificationsService.generateQrReminderMessage(
      customerId,
      storeId,
    );
  }
}
