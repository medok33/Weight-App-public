import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ObservabilityController } from './controllers/observability.controller';
import { ObservabilityService } from './application/observability.service';
import { ObservabilityRepository } from './infrastructure/observability.repository';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ObservabilityController],
  providers: [ObservabilityService, ObservabilityRepository],
  exports: [ObservabilityService],
})
export class ObservabilityModule {}
