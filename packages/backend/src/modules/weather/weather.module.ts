// ── weather/weather.module.ts ────────────────────────────────────
// NestJS module: weather intelligence with interchangeable providers
// ─────────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { JackpotConfigEntity } from '../../database/entities/jackpot-config.entity';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';
import { OpenMeteoProvider } from './providers/open-meteo.provider';
import { OpenWeatherProvider } from './providers/openweather.provider';

@Module({
  imports: [TypeOrmModule.forFeature([StoreEntity, JackpotConfigEntity])],
  controllers: [WeatherController],
  providers: [WeatherService, OpenMeteoProvider, OpenWeatherProvider],
  exports: [WeatherService],
})
export class WeatherModule {}
