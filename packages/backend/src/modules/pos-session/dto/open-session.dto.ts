import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for opening a POS session.
 *
 * employeeId is NOT in the body — it comes from the authenticated JWT
 * (req.user.employeeId). The client cannot set it.
 */
export class OpenSessionDto {
  /**
   * Optional terminal identifier. If provided, the session is bound to
   * this terminal. If not, the session is bound to (store, employee) only.
   * Future strate II work may require this; (1a) accepts but doesn't enforce.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  terminalId?: string;

  /**
   * Explicit flag for offline mode at session open. Defaults to false.
   */
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  offlineMode?: boolean;
}
