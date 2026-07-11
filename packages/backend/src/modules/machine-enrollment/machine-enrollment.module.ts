import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PosMachineEntity } from '../../database/entities/pos-machine.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { MachineEnrollmentService } from './machine-enrollment.service';
import { MachineEnrollmentController } from './machine-enrollment.controller';

/**
 * Enrôlement machine POS (Partie B) — identité matérielle déclarée par la
 * caisse et validée par le back-office. Le service est exporté pour que le
 * moteur de vente puisse évaluer la barrière d'enrôlement.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PosMachineEntity, StoreEntity])],
  controllers: [MachineEnrollmentController],
  providers: [MachineEnrollmentService],
  exports: [MachineEnrollmentService],
})
export class MachineEnrollmentModule {}
