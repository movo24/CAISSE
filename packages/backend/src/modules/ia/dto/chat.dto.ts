import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Chat DTO ────────────────────────────────────────────────────────────

class ChatHistoryEntry {
  @IsString()
  role: string;

  @IsString()
  content: string;
}

export class ChatDto {
  @ApiProperty({
    description: 'Message utilisateur en langage naturel',
    example: 'Quelles sont mes ventes aujourd\'hui ?',
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({
    description: 'Historique de conversation (derniers échanges)',
    type: [ChatHistoryEntry],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatHistoryEntry)
  history?: ChatHistoryEntry[];

  // Injected by TenantInterceptor — must be whitelisted
  @IsOptional()
  @IsString()
  storeId?: string;
}

// ── Generate Report DTO ─────────────────────────────────────────────────

export class GenerateReportDto {
  @ApiProperty({
    description: 'Type de rapport à générer',
    enum: ['daily_summary', 'weekly_analysis', 'product_performance', 'cashier_analysis'],
    example: 'daily_summary',
  })
  @IsEnum(['daily_summary', 'weekly_analysis', 'product_performance', 'cashier_analysis'])
  reportType: string;

  @ApiPropertyOptional({
    description: 'Date cible (YYYY-MM-DD). Défaut: aujourd\'hui',
    example: '2025-01-15',
  })
  @IsOptional()
  @IsString()
  date?: string;

  // Injected by TenantInterceptor — must be whitelisted
  @IsOptional()
  @IsString()
  storeId?: string;
}
