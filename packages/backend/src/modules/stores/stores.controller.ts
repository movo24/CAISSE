import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { StoreScheduleAdminService, ScheduleDayDto } from '../store-schedule/store-schedule-admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CreateStoreDto, UpdateStoreDto } from '../../common/dto';
import { BusinessError } from '../../common/errors/business-error';

@ApiTags('stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stores')
export class StoresController {
  constructor(
    private storesService: StoresService,
    private scheduleAdmin: StoreScheduleAdminService,
  ) {}

  /**
   * GET /api/stores — list all stores (for backoffice tour de controle)
   */
  @Get()
  @ApiOperation({ summary: 'List all stores (optionally filter by org/unit)' })
  findAll(
    @Query('organizationId') organizationId?: string,
    @Query('unitId') unitId?: string,
  ) {
    return this.storesService.findAll({ organizationId, unitId });
  }

  /**
   * POST /api/stores — create a new store
   */
  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create a new store' })
  create(@Body() dto: CreateStoreDto) {
    return this.storesService.create(dto);
  }

  /**
   * GET /api/stores/accessible — stores the current user can access.
   * Admin: all active stores. Manager/Cashier: own store only.
   */
  @Get('accessible')
  @ApiOperation({ summary: 'List stores accessible by current user' })
  async accessible(@Request() req: any) {
    if (req.user.role === 'admin') {
      return this.storesService.findAll();
    }
    const store = await this.storesService.findMyStore(req.user.storeId);
    return [store];
  }

  /**
   * GET /api/stores/network-summary — consolidated KPIs across all stores.
   * Only includes stores with includeInNetwork=true.
   */
  @Get('network-summary')
  @Roles('admin')
  @ApiOperation({ summary: 'Consolidated network KPIs across all stores' })
  async networkSummary() {
    return this.storesService.getNetworkSummary();
  }

  /**
   * GET /api/stores/me — returns the authenticated user's own store.
   * No cross-tenant leak: you can only see YOUR store.
   */
  @Get('me')
  @ApiOperation({ summary: 'Get my store details' })
  getMyStore(@Request() req: any) {
    return this.storesService.findMyStore(req.user.storeId);
  }

  /**
   * GET /api/stores/me/info — returns store info formatted for POS ticket rendering.
   * Maps StoreEntity fields to the frontend StoreInfo interface.
   */
  @Get('me/info')
  @ApiOperation({ summary: 'Get store info for POS (StoreInfo format)' })
  getMyStoreInfo(@Request() req: any) {
    return this.storesService.getStoreInfo(req.user.storeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a store by ID' })
  findOne(@Param('id') id: string, @Request() req: any) {
    // Admins can view any store; others only their own
    if (req.user.role !== 'admin' && id !== req.user.storeId) {
      throw BusinessError.forbidden('You can only access your own store');
    }
    return this.storesService.findMyStore(id);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a store (admin only)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStoreDto,
    @Request() req: any,
  ) {
    // Admins can update any store — pass null to skip caller check
    return this.storesService.update(id, dto, req.user.role === 'admin' ? id : req.user.storeId);
  }

  @Patch(':id/archive')
  @Roles('admin')
  @ApiOperation({ summary: 'Archive a store (soft-delete, data preserved)' })
  archive(@Param('id') id: string, @Request() req: any) {
    return this.storesService.archive(id, req.user.employeeId);
  }

  @Patch(':id/reactivate')
  @Roles('admin')
  @ApiOperation({ summary: 'Reactivate an archived store' })
  reactivate(@Param('id') id: string, @Request() req: any) {
    return this.storesService.reactivate(id, req.user.employeeId);
  }

  @Post(':id/activate')
  @Roles('admin')
  @ApiOperation({ summary: 'Activate a store' })
  activate(@Param('id') id: string) {
    return this.storesService.activate(id);
  }

  @Post(':id/deactivate')
  @Roles('admin')
  @ApiOperation({ summary: 'Deactivate a store' })
  deactivate(@Param('id') id: string) {
    return this.storesService.deactivate(id);
  }

  @Post('sync')
  @Roles('admin')
  @ApiOperation({ summary: 'Sync stores from TimeWin24 (source of truth)' })
  syncFromTimeWin() {
    return this.storesService.syncFromTimeWin();
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Hard-delete a store and ALL related data (irreversible)' })
  hardDelete(@Param('id') id: string, @Request() req: any) {
    // Cannot delete your own store — it would destroy your own session
    if (id === req.user.storeId) {
      throw BusinessError.forbidden(
        'Vous ne pouvez pas supprimer le magasin auquel vous êtes connecté. Connectez-vous à un autre magasin d\'abord.',
      );
    }
    return this.storesService.hardDelete(id, req.user.employeeId);
  }

  // ── Operating Hours ──
  // The schedule DATUM lives in analytics.store_weekly_hours (the resolver's
  // single source — store_closed_late + close beat). This admin surface is the
  // write path (server validation = the guarantee); the legacy TimeWin24 push
  // is kept as a best-effort DOWNSTREAM sync (fail-soft, never authoritative).

  @Get(':id/schedule')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get store operating hours (schedule datum)' })
  getSchedule(@Param('id') id: string) {
    return this.scheduleAdmin.getWeekly(id);
  }

  @Put(':id/schedule')
  @Roles('admin')
  @ApiOperation({ summary: 'Update store operating hours (validated; atomic audit; TW24 best-effort)' })
  async updateSchedule(@Param('id') id: string, @Body() body: { schedules: ScheduleDayDto[] }, @Request() req: any) {
    await this.scheduleAdmin.putWeekly(id, body?.schedules, req.user.employeeId);
    // downstream sync — fail-soft inside (a TW24 outage never blocks the datum write)
    await this.storesService.updateStoreSchedule(id, body.schedules);
    return this.scheduleAdmin.getWeekly(id);
  }

  @Get(':id/holiday-closures')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Holiday checklist (checked = this store closes)' })
  getHolidayClosures(@Param('id') id: string) {
    return this.scheduleAdmin.getHolidays(id);
  }

  @Put(':id/holiday-closures')
  @Roles('admin')
  @ApiOperation({ summary: 'Update the holiday closure selection (atomic audit)' })
  async updateHolidayClosures(@Param('id') id: string, @Body() body: { closedHolidayKeys: string[] }, @Request() req: any) {
    await this.scheduleAdmin.putHolidays(id, body?.closedHolidayKeys, req.user.employeeId);
    return this.scheduleAdmin.getHolidays(id);
  }
}
