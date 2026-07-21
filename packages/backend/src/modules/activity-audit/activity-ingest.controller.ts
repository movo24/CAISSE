import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SkipTenantCheck } from '../../common/interceptors/tenant.interceptor';
import { ActivityService } from './activity.service';

class ViewEventDto {
  @IsString() @MaxLength(64) action: string;
  @IsOptional() @IsString() @MaxLength(64) storeId?: string;
  @IsOptional() @IsString() @MaxLength(64) module?: string;
  @IsOptional() @IsString() @MaxLength(64) screen?: string;
  @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @IsOptional() @IsString() @MaxLength(128) sourceRoute?: string;
  @IsOptional() @IsString() @MaxLength(64) sessionId?: string;
  @IsOptional() @IsString() @MaxLength(32) deviceType?: string;
  @IsOptional() @IsInt() @Min(0) durationMs?: number;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

class IngestViewEventsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ViewEventDto)
  events: ViewEventDto[];
}

/**
 * Ingestion des consultations depuis le client de pilotage. Authentifié : l'identité
 * (employeeId) est ESTAMPILLÉE serveur depuis le JWT — jamais lue du body. Actions
 * hors liste blanche ignorées ; métadonnée nettoyée + bornée côté service. Non bloquant.
 */
@ApiTags('activity-ingest')
@ApiBearerAuth()
@Controller('activity')
@UseGuards(JwtAuthGuard)
@SkipTenantCheck()
export class ActivityIngestController {
  constructor(private readonly activity: ActivityService) {}

  @Post('view-events')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  @ApiOperation({ summary: 'Enregistrer un lot d’événements de consultation (batch ≤ 50)' })
  async ingest(@Body() body: IngestViewEventsDto, @Req() req: any) {
    const events = Array.isArray(body?.events) ? body.events : [];
    let accepted = 0;
    for (const e of events) {
      const ok = await this.activity.recordView({
        employeeId: req.user.employeeId, // identité serveur (jamais le body)
        sessionId: e.sessionId ?? null,
        storeId: e.storeId ?? null,
        module: e.module ?? null,
        screen: e.screen ?? null,
        entityType: e.entityType ?? null,
        entityId: e.entityId ?? null,
        action: String(e.action ?? ''),
        sourceRoute: e.sourceRoute ?? null,
        durationMs: e.durationMs ?? null,
        metadata: e.metadata,
        ipAddress: req.ip ?? null,
        deviceType: e.deviceType ?? null,
      });
      if (ok) accepted += 1;
    }
    return { accepted, received: events.length };
  }
}
