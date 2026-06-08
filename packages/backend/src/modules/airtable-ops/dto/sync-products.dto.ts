import { IsOptional, IsUUID, IsBoolean } from 'class-validator';

export class SyncProductsDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  /**
   * When true, exports ALL products regardless of lastSyncedAt.
   * Defaults to false (incremental — only products updated since last sync).
   */
  @IsOptional()
  @IsBoolean()
  forceAll?: boolean;
}
