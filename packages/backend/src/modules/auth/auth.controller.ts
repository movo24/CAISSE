import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Request, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsNotEmpty, IsOptional, MinLength, MaxLength, IsUUID } from 'class-validator';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { SkipTenantCheck } from '../../common/interceptors/tenant.interceptor';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

const isProd = process.env.NODE_ENV === 'production';
const REFRESH_COOKIE_NAME = 'caisse_refresh_token';
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

class LoginPinDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  storeId: string;

  @IsString()
  @MinLength(4, { message: 'PIN must be at least 4 characters' })
  @MaxLength(8, { message: 'PIN must be at most 8 characters' })
  pin: string;
}

class LoginAdminDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(4, { message: 'PIN must be at least 4 characters' })
  @MaxLength(8, { message: 'PIN must be at most 8 characters' })
  pin: string;
}

class LoginQrDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  qrCode: string;

  @IsString()
  @MinLength(4, { message: 'PIN must be at least 4 characters' })
  @MaxLength(8, { message: 'PIN must be at most 8 characters' })
  pin: string;
}

class RefreshTokenDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

@ApiTags('auth')
@Controller('auth')
@SkipTenantCheck() // Auth endpoints are pre-authentication
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with store ID + PIN' })
  // Strict rate limit: 5 attempts per 60 seconds per IP
  // Prevents brute-force on 4-digit PINs (10,000 combinations)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async loginPin(
    @Body() dto: LoginPinDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginByPin(dto.storeId, dto.pin);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  /**
   * POST /auth/login/admin — Super admin login with email + PIN (no storeId required).
   * Returns access to ALL stores.
   */
  @Post('login/admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Super admin login with email + PIN (no store ID)' })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async loginAdmin(
    @Body() dto: LoginAdminDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginByEmail(dto.email, dto.pin);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @Post('login/qr')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with QR code + PIN' })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async loginQr(
    @Body() dto: LoginQrDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginByQrCode(dto.qrCode, dto.pin);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token (body or httpOnly cookie)' })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Accept refresh token from body OR httpOnly cookie
    const refreshToken = dto.refreshToken || req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      res.status(HttpStatus.UNAUTHORIZED).json({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'Refresh token required',
      });
      return;
    }

    const result = await this.authService.refreshAccessToken(refreshToken);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Logout and invalidate current token' })
  async logout(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.authService.logout(req.user.employeeId);
    this.clearRefreshCookie(res);
    return { message: 'Logged out successfully' };
  }

  // ─────────────────────────────────────────────────────────────
  // Cookie helpers
  // ─────────────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'strict' : 'lax',
      maxAge: REFRESH_COOKIE_MAX_AGE,
      path: '/api/auth',
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'strict' : 'lax',
      path: '/api/auth',
    });
  }
}
