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
  IsBoolean,
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
  @ApiProperty({ example: 'cash', enum: ['cash', 'card', 'mobile', 'check', 'voucher', 'store_credit'] })
  @IsString()
  @IsIn(['cash', 'card', 'mobile', 'check', 'voucher', 'store_credit'])
  method: string;

  @ApiProperty({ example: 1500, description: 'Amount APPLIED to the ticket in minor units (cents) — never exceeds the residual due' })
  @IsInt()
  @Min(0)
  amountMinorUnits: number;

  @ApiPropertyOptional({ example: 2000, description: 'Cash physically received (cash only). >= amountMinorUnits; the excess is change given back — a distinct cash movement, never applied to the ticket.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  cashReceivedMinorUnits?: number;

  @ApiPropertyOptional({ example: 'pi_3ABC123', description: 'Stripe PaymentIntent ID (for card payments)' })
  @IsOptional()
  @IsString()
  stripePaymentIntentId?: string;

  @ApiPropertyOptional({ description: 'Stripe Terminal reader id (card payments)' })
  @IsOptional()
  @IsString()
  stripeReaderId?: string;

  @ApiPropertyOptional({ description: 'Physical payment terminal id (card payments)' })
  @IsOptional()
  @IsString()
  terminalId?: string;

  @ApiPropertyOptional({ description: 'Card leg not really captured yet → sale stays payment_pending until regularised' })
  @IsOptional()
  @IsBoolean()
  pendingCapture?: boolean;

  @ApiPropertyOptional({ description: "Required when method === 'store_credit': the avoir/credit-note code to redeem (M005)" })
  @IsOptional()
  @IsString()
  creditNoteCode?: string;
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

  @ApiPropertyOptional({ example: 200, description: 'Manual cart discount (centimes) — capped at 30%, requires a manager approver' })
  @IsOptional()
  @IsInt()
  @Min(0)
  manualDiscountMinorUnits?: number;

  @ApiPropertyOptional({ description: 'Manager/admin employee id authorising a manual discount' })
  @IsOptional()
  @IsString()
  discountApproverId?: string;

  @ApiPropertyOptional({ example: 'BIENVENUE10', description: 'Owner-defined promo code applied at the sale (decision 6)' })
  @IsOptional()
  @IsString()
  promoCode?: string;
}
