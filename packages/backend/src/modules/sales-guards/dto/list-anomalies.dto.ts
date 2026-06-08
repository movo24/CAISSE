import { IsOptional, IsUUID, IsString, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { AnomalyStatus, GuardSeverity } from '../sales-guards.types';

const STATUSES: AnomalyStatus[] = ['detected', 'approved', 'ignored', 'resolved'];
const SEVERITIES: GuardSeverity[] = ['info', 'warning', 'critical'];

export class ListAnomaliesDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: AnomalyStatus;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: GuardSeverity;

  /** ISO date (YYYY-MM-DD) — filters createdAt >= this day start */
  @IsOptional()
  @IsString()
  from?: string;

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
  limit?: number = 50;
}
