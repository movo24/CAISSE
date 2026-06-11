import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for provisioning a logical POS till.
 *
 * storeId is NOT in the body — it comes from the authenticated JWT
 * (req.user.storeId). A manager provisions only for their own store.
 */
export class ProvisionTerminalDto {
  /** The identifier the terminal will declare via X-Terminal-Id. */
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  terminalCode: string;

  /** Human-readable label, e.g. "Caisse 1". */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  label?: string;
}
