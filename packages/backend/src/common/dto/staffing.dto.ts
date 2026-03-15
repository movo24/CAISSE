import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitStaffingSnapshotDto {
  @ApiPropertyOptional({ example: 'optimal', enum: ['understaffed', 'optimal', 'overstaffed', 'unknown'] })
  @IsOptional()
  @IsString()
  level?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  currentHourTx?: number;

  @ApiPropertyOptional({ example: 45000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  currentHourRevenue?: number;

  @ApiPropertyOptional({ type: [Object], description: 'Active cashier objects' })
  @IsOptional()
  @IsArray()
  activeCashiers?: any[];

  @ApiPropertyOptional({ type: [Object], description: 'Hourly snapshot data' })
  @IsOptional()
  @IsArray()
  hourlySnapshots?: any[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastRecommendation?: string;
}
