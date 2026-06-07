import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsIn,
  Min,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInventoryScanDto {
  @ApiProperty({ example: '3017620422003', description: 'Barcode (EAN-13, EAN-8, etc.)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  barcode: string;

  @ApiProperty({ example: 1, description: 'Quantity scanned', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiProperty({ example: 'inventory', description: 'Type of scan', required: false })
  @IsOptional()
  @IsString()
  @IsIn(['inventory', 'receiving', 'adjustment', 'return'])
  scanType?: 'inventory' | 'receiving' | 'adjustment' | 'return';

  @ApiProperty({ example: 'Palette 3 rayon frais', description: 'Optional notes', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ description: 'Session UUID for batch grouping', required: false })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiProperty({
    description: 'Client-side idempotency key (offline queue entry id). Same key = same scan, not duplicated.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientEntryId?: string;
}

export class ApplyScansDto {
  @ApiProperty({ description: 'Session UUID to apply (optional — applies all matched if omitted)', required: false })
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
