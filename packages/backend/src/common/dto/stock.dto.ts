import {
  IsInt,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustStockDto {
  @ApiProperty({ example: 50, description: 'Stock quantity (absolute new value, or delta depending on mode)' })
  @IsInt()
  quantity: number;

  @ApiProperty({ example: 'Inventaire physique', description: 'Reason for adjustment' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiProperty({ example: 'absolute', description: 'Mode: absolute = set to this value, delta = add/subtract from current', required: false })
  @IsOptional()
  @IsString()
  @IsIn(['absolute', 'delta'])
  mode?: 'absolute' | 'delta';
}

export class UpdateThresholdsDto {
  @ApiProperty({ example: 10, description: 'Alert threshold' })
  @IsInt()
  @Min(0)
  alertThreshold: number;

  @ApiProperty({ example: 5, description: 'Critical threshold' })
  @IsInt()
  @Min(0)
  criticalThreshold: number;
}
