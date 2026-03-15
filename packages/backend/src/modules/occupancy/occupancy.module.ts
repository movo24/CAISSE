import { Module } from '@nestjs/common';
import { OccupancyService } from './occupancy.service';
import { OccupancyController } from './occupancy.controller';
import { WeatherModule } from '../weather/weather.module';

@Module({
  imports: [WeatherModule],
  controllers: [OccupancyController],
  providers: [OccupancyService],
  exports: [OccupancyService],
})
export class OccupancyModule {}
