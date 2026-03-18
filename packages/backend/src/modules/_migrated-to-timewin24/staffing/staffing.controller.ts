import { Controller, Post, Get, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffingService } from './staffing.service';
import { SubmitStaffingSnapshotDto } from '../../common/dto';

@Controller('staffing')
@UseGuards(JwtAuthGuard)
export class StaffingController {
  constructor(private readonly staffingService: StaffingService) {}

  @Post('snapshot')
  submitSnapshot(@Body() dto: SubmitStaffingSnapshotDto, @Request() req: any) {
    return this.staffingService.submitSnapshot(req.user.storeId, dto);
  }

  @Get('targets/:storeId')
  getTargets(@Param('storeId') storeId: string) {
    return this.staffingService.getTargets(storeId);
  }

  @Get('history/:storeId')
  getHistory(@Param('storeId') storeId: string, @Query('date') date: string) {
    return this.staffingService.getHistory(storeId, date);
  }
}
