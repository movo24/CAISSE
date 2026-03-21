import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PointageEntryEntity } from '../../database/entities/pointage-entry.entity';
import { PointageController } from './pointage.controller';
import { PointageService } from './pointage.service';

@Module({
  imports: [TypeOrmModule.forFeature([PointageEntryEntity])],
  controllers: [PointageController],
  providers: [PointageService],
  exports: [PointageService],
})
export class PointageModule {}
