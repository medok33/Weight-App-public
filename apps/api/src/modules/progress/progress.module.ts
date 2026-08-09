import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ProgressController } from './controllers/progress.controller';
import { ProgressService } from './application/progress.service';
import { ProgressRepository } from './infrastructure/progress.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [ProgressController],
  providers: [ProgressService, ProgressRepository],
  exports: [ProgressService, ProgressRepository],
})
export class ProgressModule {}
