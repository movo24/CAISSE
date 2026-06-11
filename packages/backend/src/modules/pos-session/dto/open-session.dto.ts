import { IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for opening a POS session.
 *
 * NOT in the body:
 *   - employeeId — comes from the authenticated JWT (req.user.employeeId).
 *     The client cannot set it.
 *   - terminalId — comes from the X-Terminal-Id header (γ-model: sessions
 *     are terminal-bound, the header is required). Body cannot set it
 *     either: one source of truth, no ambiguity between body and header.
 */
export class OpenSessionDto {
  /**
   * Explicit flag for offline mode at session open. Defaults to false.
   */
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  offlineMode?: boolean;
}
