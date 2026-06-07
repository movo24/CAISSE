import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';

import { AirtableOpsService } from './airtable-ops.service';
import { AirtableOpsConfig } from './airtable-ops.config';
import { ListOperationsDto, RejectOperationDto } from './dto/list-operations.dto';
import { SyncProductsDto } from './dto/sync-products.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/** JWT payload shape (see auth/jwt.strategy.ts) — role is a STRING. */
type AuthUser = {
  employeeId: string;
  storeId: string;
  role: 'admin' | 'manager' | 'cashier';
};

const ROLE_LEVEL: Record<string, number> = { cashier: 0, manager: 1, admin: 2 };
const roleLevel = (role: string): number => ROLE_LEVEL[role] ?? 0;

/**
 * Airtable Ops REST API.
 *
 * All endpoints except /webhook require a valid JWT.
 * Role-based enforcement is delegated to the service layer.
 */
@Controller('airtable-ops')
export class AirtableOpsController {
  private readonly logger = new Logger(AirtableOpsController.name);

  constructor(
    private readonly service: AirtableOpsService,
    private readonly config: AirtableOpsConfig,
  ) {}

  // ── Operations ────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('operations')
  listOperations(@Query() dto: ListOperationsDto) {
    return this.service.listOperations(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('operations/:id')
  getOperation(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getOperation(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('operations/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveOperation(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.service.approveOperation(id, req.user.employeeId, roleLevel(req.user.role));
  }

  @UseGuards(JwtAuthGuard)
  @Post('operations/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectOperation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOperationDto,
    @Req() req: Request & { user: AuthUser },
  ) {
    if (!dto?.reason?.trim()) {
      throw new BadRequestException('reason is required when rejecting an operation');
    }
    return this.service.rejectOperation(id, req.user.employeeId, dto.reason);
  }

  @UseGuards(JwtAuthGuard)
  @Post('operations/:id/apply')
  @HttpCode(HttpStatus.OK)
  applyOperation(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.service.applyOperation(id, roleLevel(req.user.role));
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  triggerSync(@Body() dto: SyncProductsDto) {
    return this.service.triggerManualSync(dto.storeId);
  }

  // ── Stats & logs ─────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('stats')
  getStats(@Query('storeId') storeId?: string) {
    return this.service.getStats(storeId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('logs')
  getLogs(
    @Query('storeId') storeId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.service.listSyncLogs(storeId, parsedLimit);
  }

  // ── Airtable webhook (no JWT — HMAC verified) ─────────────────────────────

  /**
   * Airtable calls this endpoint when a record changes.
   * We verify the HMAC-SHA256 signature using AIRTABLE_WEBHOOK_SECRET,
   * then trigger an incremental sync in the background.
   *
   * IMPORTANT: This endpoint must NOT trust any fields from the payload body
   * to perform actions — it only triggers a safe pull sync.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  async handleWebhook(
    @Req() req: Request,
    // Plain Record type → global ValidationPipe skips it (no DTO whitelist 400).
    // Trust comes from the HMAC check below, not from body shape.
    @Body() payload: Record<string, any>,
  ): Promise<void> {
    if (!this.config.enabled) return;

    this.verifyAirtableSignature(req);

    this.logger.log(
      `Airtable webhook received: baseId=${payload.baseId} cursor=${payload.cursor}`,
    );

    // Fire-and-forget incremental import
    Promise.resolve()
      .then(() =>
        this.service['syncService'].importProductSuggestions(undefined, 'WEBHOOK'),
      )
      .catch((err: any) =>
        this.logger.error(`Webhook-triggered import failed: ${err?.message}`),
      );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Verifies the Airtable HMAC-SHA256 signature.
   * Airtable sends the signature in the `X-Airtable-Client-Secret` header
   * (or `X-Airtable-Hmac-SHA256` depending on the webhook version).
   * We compute HMAC(webhookSecret, rawBody) and compare.
   */
  private verifyAirtableSignature(req: Request): void {
    if (!this.config.webhookSecret) {
      throw new UnauthorizedException('Webhook secret not configured');
    }

    const signature =
      (req.headers['x-airtable-hmac-sha256'] as string) ||
      (req.headers['x-airtable-client-secret'] as string);

    if (!signature) {
      throw new UnauthorizedException('Missing Airtable signature header');
    }

    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      throw new UnauthorizedException(
        'Raw body unavailable — ensure rawBody middleware is active',
      );
    }

    const expected = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new UnauthorizedException('Invalid Airtable webhook signature');
    }
  }
}
