import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReadOnlyGuard } from './read-only.guard';

/**
 * Wesley Command Center — étage 1 (mobile-read-api). GET-only cockpit read surface.
 *
 * Auth (`JwtAuthGuard`) + INV-1 read-only (`ReadOnlyGuard`) apply to the WHOLE
 * controller. NO endpoints yet — they are added one per commit AFTER the scope rule
 * (403 on an explicit out-of-scope request vs silent empty filter) is decided.
 * Every future endpoint will read ONLY `analytics.*` (never the sources).
 */
@Controller('mobile/v1')
@UseGuards(JwtAuthGuard, ReadOnlyGuard)
export class MobileReadController {}
