import {
  Controller,
  Post,
  Patch,
  Get,
  Delete,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MobileAuthGuard } from '../../common/guards/mobile-auth.guard';
import { MobileAuthService } from './mobile-auth.service';

@ApiTags('mobile/auth')
@Controller('mobile')
export class MobileAuthController {
  constructor(private readonly authService: MobileAuthService) {}

  @Post('auth/register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 3600000, limit: 3 } }) // 3/h per IP
  @ApiOperation({ summary: 'Register a customer + issue welcome coupon (-5%)' })
  async register(
    @Body()
    body: {
      email: string;
      password: string;
      firstName?: string;
      preferredStoreId?: string;
    },
  ) {
    return this.authService.register(body);
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5/min per IP
  @ApiOperation({ summary: 'Customer login (email + password)' })
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout (client-side token discard)' })
  async logout() {
    return { success: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(MobileAuthGuard)
  @ApiOperation({ summary: 'Get my profile' })
  async getMe(@Request() req: any) {
    return this.authService.getMe(req.customer.id);
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(MobileAuthGuard)
  @ApiOperation({ summary: 'Update my profile' })
  async updateMe(
    @Request() req: any,
    @Body() body: { firstName?: string; preferredStoreId?: string },
  ) {
    return this.authService.updateMe(req.customer.id, body);
  }

  @Delete('me')
  @ApiBearerAuth()
  @UseGuards(MobileAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete my account (RGPD, anonymized after 30j)' })
  async deleteMe(@Request() req: any) {
    return this.authService.deleteMe(req.customer.id);
  }
}
