import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { APPLICATION_ROLES } from './application-access.constants';

export class GrantApplicationAccessDto {
  @IsIn(APPLICATION_ROLES as unknown as string[])
  applicationRole: string;

  @IsOptional()
  @IsBoolean()
  applicationEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  permissionLevel?: number;

  @IsOptional()
  @IsUUID()
  primaryStoreId?: string;

  @IsOptional()
  @IsISO8601()
  validFrom?: string;

  @IsOptional()
  @IsISO8601()
  validUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class GrantStoreAccessDto {
  @IsOptional()
  @IsIn(APPLICATION_ROLES as unknown as string[])
  accessRole?: string;

  @IsOptional() @IsBoolean() canViewDashboard?: boolean;
  @IsOptional() @IsBoolean() canViewFinancials?: boolean;
  @IsOptional() @IsBoolean() canViewEmployees?: boolean;
  @IsOptional() @IsBoolean() canViewAlerts?: boolean;
  @IsOptional() @IsBoolean() canCompare?: boolean;

  @IsOptional() @IsISO8601() validFrom?: string;
  @IsOptional() @IsISO8601() validUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SuspendDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
