import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrencyService } from './currency.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@ApiTags('currency')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('currency')
export class CurrencyController {
  constructor(private currencyService: CurrencyService) {}

  @Post('rates')
  @Roles('admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Set an FX rate (manual)' })
  setRate(
    @Body()
    body: {
      baseCurrency: string;
      quoteCurrency: string;
      rate: number;
      source?: string;
    },
  ) {
    return this.currencyService.setRate(body);
  }

  @Get('rates')
  @ApiOperation({ summary: 'Get all latest FX rates' })
  getAllRates() {
    return this.currencyService.getAllRates();
  }

  @Get('rates/pair')
  @ApiOperation({ summary: 'Get latest FX rate for a currency pair' })
  getRate(
    @Query('base') base: string,
    @Query('quote') quote: string,
  ) {
    return this.currencyService.getLatestRate(base, quote);
  }

  @Get('convert')
  @ApiOperation({ summary: 'Convert amount between currencies' })
  convert(
    @Query('amount') amount: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.currencyService.convert(parseInt(amount), from, to);
  }
}
