import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { RetentionController } from './controllers/retention.controller';
import { RetentionService } from './application/retention.service';
import { RetentionRepository } from './infrastructure/retention.repository';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RetentionController],
  providers: [RetentionService, RetentionRepository],
  exports: [RetentionService],
})
export class RetentionModule {}
