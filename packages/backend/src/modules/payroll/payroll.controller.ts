import { Controller, Get, Put, Param, Query, Body, Request, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { PayrollService } from './payroll.service';

@Controller('payroll')
@UseGuards(JwtAuthGuard)
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get('summary')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  getMonthSummary(
    @Query('storeId') storeId: string,
    @Query('month') month: string,
    @Request() req: any,
  ) {
    return this.payrollService.getMonthSummary(storeId || req.user.storeId, month);
  }

  @Get('export')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  async exportCSV(
    @Query('storeId') storeId: string,
    @Query('month') month: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const csv = await this.payrollService.exportCSV(storeId || req.user.storeId, month);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=paie-${month}.csv`);
    res.send(csv);
  }

  @Get(':employeeId')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  getEmployeePayslip(
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
    @Request() req: any,
  ) {
    return this.payrollService.getEmployeePayslip(req.user.storeId, employeeId, month);
  }

  @Put(':employeeId/rate')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  updateRate(
    @Param('employeeId') employeeId: string,
    @Body() body: { hourlyRateGross: number; contractHoursWeek: number },
    @Request() req: any,
  ) {
    return this.payrollService.updateRate(req.user.storeId, employeeId, body);
  }
}
