import {
  IsString,
  IsEmail,
  IsOptional,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomerDto {
  @ApiProperty({ example: 'Marie' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Martin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ example: '0612345678' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'marie@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '123456', description: 'OTP code received by SMS/email' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  otpCode: string;
}
