import { Controller, Get, Post, Body, Param, Query, HttpException, Logger, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TimewinService } from './timewin.service';

/**
 * Strips sensitive fields (posPin, posQrCode) from employee objects
 * before returning to the POS frontend.
 */
function sanitizeEmployee(emp: any) {
  if (!emp) return emp;
  const { posPin, posQrCode, posPinHash, cachedAt, ...safe } = emp;
  return safe;
}

function sanitizeEmployees(list: any[]) {
  return list.map(sanitizeEmployee);
}

/**
 * Proxy controller — POS frontend calls these local endpoints,
 * which relay to TimeWin24. This avoids CORS issues and centralizes
 * the API key on the backend.
 *
 * SECURITY: health + login are public. All other endpoints require JWT.
 */
@Controller('timewin')
export class TimewinController {
  private readonly logger = new Logger(TimewinController.name);

  constructor(private readonly tw: TimewinService) {}

  /* ── Public endpoints (no auth) ── */

  @Get('health')
  async health() {
    const ok = await this.tw.isHealthy();
    return { timewin24: ok ? 'connected' : 'unreachable' };
  }

  @Post('login')
  async login(
    @Body() body: { pin?: string; qrCode?: string; employeeCode?: string; storeId: string; deviceId?: string },
  ) {
    try {
      return await this.tw.loginEmployee(body);
    } catch (err: any) {
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  /* ── Protected endpoints (JWT required) ── */

  @UseGuards(JwtAuthGuard)
  @Get('employees/:id/context')
  async context(@Param('id') id: string) {
    try {
      return await this.tw.getEmployeeContext(id);
    } catch (err: any) {
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('employees/sync')
  async syncEmployees(@Query('storeId') storeId: string) {
    try {
      const employees = await this.tw.syncEmployees(storeId);
      return { count: employees.length, employees: sanitizeEmployees(employees) };
    } catch (err: any) {
      // Fallback to cache
      const cached = this.tw.getCachedEmployees(storeId);
      if (cached) {
        return { count: cached.length, employees: sanitizeEmployees(cached), fromCache: true };
      }
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('today-shifts')
  async todayShifts(@Query('storeId') storeId: string) {
    try {
      return await this.tw.getTodayShifts(storeId);
    } catch (err: any) {
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('store-config')
  async storeConfig(@Query('storeId') storeId: string) {
    try {
      return await this.tw.getStoreConfig(storeId);
    } catch (err: any) {
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('clock-in')
  async clockIn(@Body() body: { employeeId: string; storeId: string }) {
    try {
      return await this.tw.clockIn(body.employeeId, body.storeId);
    } catch (err: any) {
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('clock-out')
  async clockOut(@Body() body: { employeeId: string; storeId: string }) {
    try {
      return await this.tw.clockOut(body.employeeId, body.storeId);
    } catch (err: any) {
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('events')
  async pushEvent(
    @Body() body: { storeId: string; eventType: string; employeeId?: string; data?: any },
  ) {
    try {
      return await this.tw.pushEvent(
        body.storeId,
        body.eventType as any,
        body.employeeId,
        body.data,
      );
    } catch (err: any) {
      this.logger.warn(`Failed to push event to TimeWin24: ${err.message}`);
      // Non-blocking — events can be retried
      return { received: false, error: err.message };
    }
  }
}
