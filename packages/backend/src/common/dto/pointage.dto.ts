import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsIn,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordPunchDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ description: 'Employee display name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  employeeName: string;

  @ApiProperty({ example: 'clock_in', enum: ['clock_in', 'clock_out', 'break_start', 'break_end'] })
  @IsString()
  @IsIn(['clock_in', 'clock_out', 'break_start', 'break_end'])
  type: string;

  @ApiProperty({ example: '2025-03-15T09:00:00.000Z' })
  @IsDateString()
  timestamp: string;

  @ApiPropertyOptional({ example: 'manual', enum: ['manual', 'qr', 'nfc', 'auto'] })
  @IsOptional()
  @IsString()
  @IsIn(['manual', 'qr', 'nfc', 'auto'])
  source?: string;

  @ApiPropertyOptional({ description: 'Custom ID (auto-generated if not provided)' })
  @IsOptional()
  @IsString()
  id?: string;
}
