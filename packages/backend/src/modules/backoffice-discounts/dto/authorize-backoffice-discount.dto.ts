import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthorizeBackofficeDiscountDto {
  @ApiProperty({ example: 10000, description: 'Cart subtotal in minor units (centimes)' })
  @IsInt()
  @Min(1)
  subtotalMinorUnits: number;

  @ApiProperty({ example: 5000, description: 'Requested discount in minor units (centimes)' })
  @IsInt()
  @Min(0)
  discountMinorUnits: number;

  @ApiPropertyOptional({ example: 'Remise négociée siège', description: 'Mandatory motif when discount > 30%' })
  @IsOptional()
  @IsString()
  justification?: string;

  @ApiPropertyOptional({ description: 'Target store (admins only); defaults to JWT store' })
  @IsOptional()
  @IsUUID()
  storeId?: string;
}
