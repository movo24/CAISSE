import { IsInt, IsString, IsNotEmpty, IsOptional, Min, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTerminalPaymentIntentDto {
  @ApiProperty({ example: 2990, description: 'Amount in minor units (centimes)' })
  @IsInt()
  @Min(50) // Stripe minimum: 50 centimes
  amount: number;

  @ApiProperty({ example: 'EUR', description: 'Currency code', required: false })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: 'T-000042', description: 'Internal ticket number' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  ticketNumber: string;

  @ApiProperty({ description: 'Description shown on card reader', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class CapturePaymentIntentDto {
  @ApiProperty({ description: 'Stripe PaymentIntent ID' })
  @IsString()
  @IsNotEmpty()
  paymentIntentId: string;
}
