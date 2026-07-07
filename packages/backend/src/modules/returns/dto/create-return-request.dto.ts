import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayNotEmpty,
  ValidateNested,
  IsInt,
  Min,
  IsIn,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class ReturnItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  lineItemId: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

/**
 * Requête de remboursement depuis la caisse (endpoint POST /returns).
 *
 * Le MOTIF est OBLIGATOIRE (mission : « motif obligatoire ») — validé au
 * périmètre HTTP par le ValidationPipe global. Il est ensuite persisté dans
 * `credit_note.reason` ET dans la chaîne d'audit (`sale_returned`), pas
 * seulement affiché. Le chemin offline (`/returns/by-ticket`) garde sa propre
 * résilience et n'est pas impacté.
 */
export class CreateReturnRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  originalSaleId: string;

  @ApiProperty({ type: [ReturnItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  @ApiProperty({ enum: ['cash', 'card', 'store_credit'] })
  @IsIn(['cash', 'card', 'store_credit'])
  refundMethod: 'cash' | 'card' | 'store_credit';

  @ApiProperty({ description: 'Motif du remboursement (obligatoire, tracé en audit)' })
  @IsString()
  @IsNotEmpty({ message: 'Le motif du remboursement est obligatoire.' })
  @MinLength(3, { message: 'Le motif doit contenir au moins 3 caractères.' })
  @MaxLength(500)
  reason: string;
}
