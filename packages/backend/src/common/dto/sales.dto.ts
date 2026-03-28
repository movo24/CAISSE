import {
  IsArray,
  IsString,
  IsInt,
  IsOptional,
  IsNotEmpty,
  ValidateNested,
  Min,
  ArrayMinSize,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaleItemDto {
  @ApiProperty({ example: '3760123456789', description: 'EAN barcode' })
  @IsString()
  @IsNotEmpty()
  ean: string;

  @ApiProperty({ example: 1, description: 'Quantity (>= 1)' })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class SalePaymentDto {
  @ApiProperty({ example: 'cash', enum: ['cash', 'card', 'mobile', 'check', 'voucher'] })
  @IsString()
  @IsIn(['cash', 'card', 'mobile', 'check', 'voucher'])
  method: string;

  @ApiProperty({ example: 1500, description: 'Amount in minor units (cents)' })
  @IsInt()
  @Min(0)
  amountMinorUnits: number;

  @ApiPropertyOptional({ example: 'pi_3ABC123', description: 'Stripe PaymentIntent ID (for card payments)' })
  @IsOptional()
  @IsString()
  stripePaymentIntentId?: string;
}

export class CreateSaleDto {
  @ApiProperty({ type: [SaleItemDto], description: 'Line items' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Sale must have at least one item' })
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items: SaleItemDto[];

  @ApiProperty({ type: [SalePaymentDto], description: 'Payments' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Sale must have at least one payment' })
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  payments: SalePaymentDto[];

  @ApiPropertyOptional({ example: 'CLI-A1B2C3D4', description: 'Customer QR code' })
  @IsOptional()
  @IsString()
  customerQrCode?: string;
}
