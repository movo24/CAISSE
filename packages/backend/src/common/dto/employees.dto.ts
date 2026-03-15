import {
  IsString,
  IsEmail,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  IsIn,
  MinLength,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'Jean' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'jean@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '1234', description: 'PIN code (4-8 digits)' })
  @IsString()
  @MinLength(4)
  @MaxLength(8)
  pin: string;

  @ApiProperty({ example: 'cashier', enum: ['admin', 'manager', 'cashier'] })
  @IsString()
  @IsIn(['admin', 'manager', 'cashier'])
  role: string;

  @ApiPropertyOptional({ example: 5, description: 'Max discount % (default: 5)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxDiscountPercent?: number;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'New PIN (4-8 digits)' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(8)
  pin?: string;

  @ApiPropertyOptional({ enum: ['admin', 'manager', 'cashier'] })
  @IsOptional()
  @IsString()
  @IsIn(['admin', 'manager', 'cashier'])
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxDiscountPercent?: number;
}
