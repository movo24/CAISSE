import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShiftDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ example: '2025-03-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @IsNotEmpty()
  startTime: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  @IsNotEmpty()
  endTime: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateShiftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CopyWeekDto {
  @ApiProperty({ example: '2025-03-10', description: 'Source week start date (Monday)' })
  @IsDateString()
  sourceWeekStart: string;

  @ApiPropertyOptional({ description: 'Target week start date (defaults to current week)' })
  @IsOptional()
  @IsDateString()
  targetWeekStart?: string;
}
