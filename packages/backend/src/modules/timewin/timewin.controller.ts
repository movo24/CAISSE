import { Controller, Get, Post, Put, Body, Param, Query, Request, HttpException, ForbiddenException, Logger, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { TimewinService } from './timewin.service';

/**
 * Tenant scoping (M203 follow-up): a non-admin may only target their OWN store.
 * Admin may override via the query param. A non-admin passing another store → 403.
 * Mirrors sync.controller's resolveStoreId so /timewin/* can't be used to read or
 * write another store's data with a caller-supplied storeId.
 */
function resolveStoreId(req: any, queryStoreId?: string): string {
  const role = req?.user?.role;
  const userStore = req?.user?.storeId;
  if (role === 'admin' && queryStoreId) return queryStoreId;
  if (queryStoreId && queryStoreId !== userStore) {
    throw new ForbiddenException('Accès interdit à ce magasin.');
  }
  return queryStoreId || userStore;
}

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

  /* ── Health (auth required to avoid leaking infra status) ── */

  @Get('health')
  @UseGuards(JwtAuthGuard)
  async health() {
    const ok = await this.tw.isHealthy();
    return {
      timewin24: ok ? 'connected' : 'unreachable',
      circuit: this.tw.getCircuitState(),
    };
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
  async syncEmployees(@Query('storeId') queryStoreId: string, @Request() req: any) {
    const storeId = resolveStoreId(req, queryStoreId);
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
  async todayShifts(@Query('storeId') queryStoreId: string, @Request() req: any) {
    const storeId = resolveStoreId(req, queryStoreId);
    try {
      return await this.tw.getTodayShifts(storeId);
    } catch (err: any) {
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  // Monthly payroll / worked hours for a store (TimeWin24 feed). Auth required (HR data).
  @UseGuards(JwtAuthGuard)
  @Get('payroll')
  async payroll(@Query('storeId') queryStoreId: string, @Query('month') month: string, @Request() req: any) {
    const storeId = resolveStoreId(req, queryStoreId);
    try {
      return await this.tw.getMonthlyPayroll(storeId, month);
    } catch (err: any) {
      throw new HttpException(err.response || { error: err.message }, err.status || 502);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('store-config')
  async storeConfig(@Query('storeId') queryStoreId: string, @Request() req: any) {
    const storeId = resolveStoreId(req, queryStoreId);
    try {
      return await this.tw.getStoreConfig(storeId);
    } catch (err: any) {
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  /* ── Store schedule (operating hours) — relay to TimeWin24 ── */

  @UseGuards(JwtAuthGuard)
  @Get('store-schedule')
  async getStoreSchedule(@Query('storeId') queryStoreId: string, @Request() req: any) {
    const storeId = resolveStoreId(req, queryStoreId);
    try {
      return await this.tw.getStoreSchedule(storeId);
    } catch (err: any) {
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Put('store-schedule')
  async updateStoreSchedule(
    @Query('storeId') queryStoreId: string,
    @Body() body: { schedules: any[] },
    @Request() req: any,
  ) {
    const storeId = resolveStoreId(req, queryStoreId);
    try {
      return await this.tw.updateStoreSchedule(storeId, body?.schedules ?? []);
    } catch (err: any) {
      throw new HttpException(
        err.response || { error: err.message },
        err.status || 502,
      );
    }
  }

  /* ── Stores feed (TimeWin24 is source of truth for stores) ── */

  // Full cross-tenant store list (TimeWin24 feed) → admin only (M203 follow-up).
  // Non-admins get their own store via GET /stores/me + /stores/accessible.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('stores')
  async stores() {
    try {
      const stores = await this.tw.fetchStores();
      return { count: stores.length, stores };
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
