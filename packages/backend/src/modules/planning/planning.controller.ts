import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CreateShiftDto, UpdateShiftDto, CopyWeekDto } from '../../common/dto';

/**
 * Planning controller — shift scheduling.
 *
 * MVP: returns structured empty data so the POS frontend
 * doesn't error. A full implementation with a ShiftEntity
 * can be added later.
 */

function getWeekBounds(dateStr?: string): { weekStart: string; weekEnd: string } {
  const d = dateStr ? new Date(dateStr) : new Date();
  const day = d.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  return { weekStart: fmt(monday), weekEnd: fmt(sunday) };
}

@ApiTags('planning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('planning')
export class PlanningController {
  // ── Employee self-service ──

  @Get('me/week')
  @ApiOperation({ summary: 'Get current employee week planning' })
  getMyWeek(@Request() req: any) {
    const { weekStart, weekEnd } = getWeekBounds();
    return {
      weekStart,
      weekEnd,
      shifts: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  @Get('me/month')
  @ApiOperation({ summary: 'Get current employee month planning' })
  getMyMonth(@Request() req: any, @Query('month') month: string) {
    return {
      month: month || new Date().toISOString().slice(0, 7),
      shifts: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  // ── Admin / manager endpoints ──

  @Get('week')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get store week planning' })
  getWeek(
    @Request() req: any,
    @Query('weekStart') weekStart: string,
    @Query('storeId') storeId?: string,
  ) {
    const bounds = getWeekBounds(weekStart);
    return {
      ...bounds,
      shifts: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  @Get('month')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get store month planning' })
  getMonth(
    @Request() req: any,
    @Query('month') month: string,
    @Query('storeId') storeId?: string,
  ) {
    return {
      month: month || new Date().toISOString().slice(0, 7),
      shifts: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  @Post('shifts')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a shift' })
  createShift(@Body() dto: CreateShiftDto, @Request() req: any) {
    // Stub — return the body with an ID
    return { id: crypto.randomUUID(), ...dto, createdAt: new Date().toISOString() };
  }

  @Put('shifts/:id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update a shift' })
  updateShift(@Param('id') id: string, @Body() dto: UpdateShiftDto) {
    return { id, ...dto, updatedAt: new Date().toISOString() };
  }

  @Delete('shifts/:id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Delete a shift' })
  deleteShift(@Param('id') id: string) {
    return { deleted: true, id };
  }

  @Post('copy-week')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Copy previous week shifts' })
  copyPreviousWeek(@Body() dto: CopyWeekDto) {
    return { copied: 0, message: 'No shifts to copy (planning not yet configured)' };
  }
}
