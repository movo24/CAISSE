import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { NotifyDeviceTokenEntity } from '../../database/entities/notify-device-token.entity';
import { NotifyPreferenceEntity } from '../../database/entities/notify-preference.entity';

const PLATFORMS = ['ios', 'android', 'web'];

/**
 * Étage 4 — the account/notification WRITE surface. Deliberately a SEPARATE
 * controller from the GET-only cockpit router (ratified: «notifications/
 * preferences n'est PAS sur ce routeur») — INV-1 stays structural on the read
 * surface while registrations and preferences write here under JwtAuthGuard.
 * Ownership rule mirrors the cockpit's 404 doctrine: a foreign/unknown token is
 * NOT FOUND — indistinguishable, no existence leak.
 */
@Controller('mobile/v1/notifications')
@UseGuards(JwtAuthGuard)
export class NotifyAccountController {
  constructor(
    @InjectRepository(NotifyDeviceTokenEntity)
    private readonly devices: Repository<NotifyDeviceTokenEntity>,
    @InjectRepository(NotifyPreferenceEntity)
    private readonly prefs: Repository<NotifyPreferenceEntity>,
  ) {}

  @Post('devices')
  async register(@Req() req: any, @Body() body: { token?: string; platform?: string }) {
    const employeeId = req?.user?.employeeId;
    const token = (body?.token ?? '').trim();
    const platform = (body?.platform ?? '').trim().toLowerCase();
    if (!token || !PLATFORMS.includes(platform)) {
      throw new BadRequestException('token and platform (ios|android|web) are required');
    }
    // Upsert by token: the latest registrant claims the device (re-login, handover).
    const existing = await this.devices.findOne({ where: { token } });
    if (existing) {
      existing.employeeId = employeeId;
      existing.platform = platform;
      existing.isActive = true;
      await this.devices.save(existing);
      return { id: existing.id, status: 'reactivated' };
    }
    const row = await this.devices.save({ employeeId, platform, token, isActive: true });
    return { id: row.id, status: 'registered' };
  }

  @Delete('devices/:token')
  async unregister(@Req() req: any, @Param('token') token: string) {
    const owned = await this.devices.findOne({
      where: { token, employeeId: req?.user?.employeeId },
    });
    if (!owned) throw new NotFoundException(); // foreign or unknown: indistinguishable
    owned.isActive = false;
    await this.devices.save(owned);
    return { status: 'unregistered' };
  }

  @Get('preferences')
  async getPreferences(@Req() req: any) {
    const employeeId = req?.user?.employeeId;
    const row = await this.prefs.findOne({ where: { employeeId } });
    // No row yet = the defaults the engine applies: enabled, no quiet window.
    return row ?? { employeeId, enabled: true, quietStartHour: null, quietEndHour: null };
  }

  @Put('preferences')
  async setPreferences(
    @Req() req: any,
    @Body() body: { enabled?: boolean; quietStartHour?: number | null; quietEndHour?: number | null },
  ) {
    const employeeId = req?.user?.employeeId;
    const { enabled, quietStartHour, quietEndHour } = body ?? {};
    const validHour = (h: unknown) => h == null || (Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 23);
    if (!validHour(quietStartHour) || !validHour(quietEndHour)) {
      throw new BadRequestException('quiet hours must be integers 0–23 or null');
    }
    if ((quietStartHour == null) !== (quietEndHour == null)) {
      throw new BadRequestException('quiet hours must be set together or both null');
    }
    await this.prefs.save({
      employeeId,
      enabled: enabled ?? true,
      quietStartHour: quietStartHour ?? null,
      quietEndHour: quietEndHour ?? null,
    });
    return this.prefs.findOne({ where: { employeeId } });
  }
}
