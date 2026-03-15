import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SyncService, SyncPushPayload } from './sync.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  @ApiOperation({
    summary: 'Push offline data from POS to server',
    description:
      'Accepts sales, customer updates, and stock adjustments ' +
      'created offline on the POS device. Returns accepted count and conflicts.',
  })
  async push(@Body() payload: SyncPushPayload) {
    return this.syncService.push(payload);
  }

  @Get('pull')
  @ApiOperation({
    summary: 'Pull server changes since last sync',
    description:
      'Returns products and customers modified since the given timestamp.',
  })
  async pull(
    @Query('storeId') storeId: string,
    @Query('lastSyncAt') lastSyncAt: string,
  ) {
    return this.syncService.pull(storeId, lastSyncAt);
  }

  @Get('status')
  @ApiOperation({
    summary: 'Get sync health status for a store',
  })
  async status(@Query('storeId') storeId: string) {
    return this.syncService.getStatus(storeId);
  }
}
