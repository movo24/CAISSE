import { IsOptional, IsUUID, IsIn, IsInt, IsString, IsNotEmpty, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import {
  AirtableOperationStatus,
  AirtableRiskLevel,
} from '../../../database/entities/airtable-operation.entity';

const VALID_STATUSES: AirtableOperationStatus[] = [
  'pending',
  'approved',
  'rejected',
  'applied',
  'failed',
];
const VALID_RISK_LEVELS: AirtableRiskLevel[] = [
  'low',
  'medium',
  'high',
  'critical',
];

export class ListOperationsDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsIn(VALID_STATUSES)
  status?: AirtableOperationStatus;

  @IsOptional()
  @IsIn(VALID_RISK_LEVELS)
  riskLevel?: AirtableRiskLevel;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class RejectOperationDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
