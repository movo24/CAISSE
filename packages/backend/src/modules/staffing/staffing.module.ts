import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffingSnapshotEntity } from '../../database/entities/staffing-snapshot.entity';
import { StaffingController } from './staffing.controller';
import { StaffingService } from './staffing.service';

@Module({
  imports: [TypeOrmModule.forFeature([StaffingSnapshotEntity])],
  controllers: [StaffingController],
  providers: [StaffingService],
  exports: [StaffingService],
})
export class StaffingModule {}
