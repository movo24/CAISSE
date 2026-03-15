import {
  IsInt,
  IsString,
  IsNotEmpty,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustStockDto {
  @ApiProperty({ example: 50, description: 'New stock quantity' })
  @IsInt()
  @Min(0)
  quantity: number;

  @ApiProperty({ example: 'Inventaire physique', description: 'Reason for adjustment' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
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
