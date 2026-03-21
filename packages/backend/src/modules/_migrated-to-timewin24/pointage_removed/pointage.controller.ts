import { Controller, Post, Get, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PointageService } from './pointage.service';
import { RecordPunchDto } from '../../common/dto';

@Controller('pointage')
@UseGuards(JwtAuthGuard)
export class PointageController {
  constructor(private readonly pointageService: PointageService) {}

  @Post('punch')
  recordPunch(@Body() dto: RecordPunchDto, @Request() req: any) {
    // Always use tenant storeId from JWT — never trust client-provided storeId
    return this.pointageService.recordPunch(req.user.storeId, dto);
  }

  @Get('today/:employeeId')
  getTodayPunches(@Param('employeeId') employeeId: string, @Request() req: any) {
    return this.pointageService.getTodayPunches(req.user.storeId, employeeId);
  }

  @Get()
  list(
    @Query('date') date: string,
    @Query('employeeId') employeeId: string,
    @Request() req: any,
  ) {
    return this.pointageService.list(req.user.storeId, { date, employeeId });
  }

  @Get('live/:storeId')
  liveStatus(@Param('storeId') storeId: string) {
    return this.pointageService.liveStatus(storeId);
  }

  @Get('summary')
  summary(
    @Query('employeeId') employeeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Request() req: any,
  ) {
    return this.pointageService.summary(req.user.storeId, { employeeId, startDate, endDate });
  }

  @Get('anomalies')
  anomalies(
    @Query('storeId') storeId: string,
    @Query('date') date: string,
    @Request() req: any,
  ) {
    return this.pointageService.anomalies(storeId || req.user.storeId, date);
  }
}
