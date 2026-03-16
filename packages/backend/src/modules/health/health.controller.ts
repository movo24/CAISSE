import { Controller, Get, Head, HttpCode, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

/**
 * Health-check endpoint used by the POS sync engine
 * to verify backend reachability.
 *
 * Exempt from rate-limiting (HEAD pinged every few seconds).
 */
@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check' })
  check() {
    return { status: 'ok', version: '1.1.0', timestamp: new Date().toISOString() };
  }

  @Head()
  @HttpCode(HttpStatus.OK)
  head() {
    // The sync engine uses HEAD — return 200 with no body
    return;
  }
}
