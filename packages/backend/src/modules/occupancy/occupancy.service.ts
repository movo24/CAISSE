import { Injectable, Logger } from '@nestjs/common';

export interface OccupancyData {
  liveCount: number;
  lastUpdate: Date;
}

@Injectable()
export class OccupancyService {
  private readonly logger = new Logger(OccupancyService.name);

  /** In-memory real-time occupancy per store. No DB needed — ephemeral data. */
  private readonly occupancyMap = new Map<string, OccupancyData>();

  // -----------------------------------------------------------------------
  // Occupancy (radar feed)
  // -----------------------------------------------------------------------

  updateOccupancy(storeId: string, liveCount: number): OccupancyData {
    const data: OccupancyData = {
      liveCount: Math.max(0, Math.round(liveCount)),
      lastUpdate: new Date(),
    };
    this.occupancyMap.set(storeId, data);
    this.logger.log(
      `Occupancy updated: store=${storeId} liveCount=${data.liveCount}`,
    );
    return data;
  }

  getOccupancy(storeId: string): OccupancyData {
    return (
      this.occupancyMap.get(storeId) || {
        liveCount: 0,
        lastUpdate: new Date(0),
      }
    );
  }

  getLiveCount(storeId: string): number {
    return this.getOccupancy(storeId).liveCount;
  }
}
