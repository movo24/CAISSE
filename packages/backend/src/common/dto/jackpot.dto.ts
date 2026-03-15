import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateJackpotConfigDto {
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  megaJackpotQuotaPerDay?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  smallWinQuotaPerDay?: number;

  @ApiPropertyOptional({ example: 5.0, description: 'Mega jackpot probability (0-100%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  megaProbabilityPercent?: number;

  @ApiPropertyOptional({ example: 15.0, description: 'Small win probability (0-100%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  smallWinProbabilityPercent?: number;

  @ApiPropertyOptional({ example: 10, description: 'Min people in store for mega jackpot' })
  @IsOptional()
  @IsInt()
  @Min(0)
  densityThresholdForMega?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Media URLs
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rouletteVideoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  winVideoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  thanksVideoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  winAudioUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  thanksAudioUrl?: string;

  // Weather API config
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  openWeatherApiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  openWeatherCity?: string;
}

export class UpdateJackpotConfigDto extends CreateJackpotConfigDto {}
