import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserSavedFilterEntity } from '../../database/entities/user-saved-filter.entity';
import { SavedFiltersService } from './saved-filters.service';
import { SavedFiltersController } from './saved-filters.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserSavedFilterEntity])],
  controllers: [SavedFiltersController],
  providers: [SavedFiltersService],
  exports: [SavedFiltersService],
})
export class SavedFiltersModule {}
