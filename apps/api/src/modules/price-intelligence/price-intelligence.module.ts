import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { PriceAdminService } from './application/price-admin.service';
import { PriceIngestionService } from './application/price-ingestion.service';
import { PriceIntelligenceEngine } from './application/price-intelligence.engine';
import { PriceIntelligenceService } from './application/price-intelligence.service';
import { PriceIntelligenceRepository } from './infrastructure/price-intelligence.repository';
import { PriceIntelligenceController } from './price-intelligence.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [PriceIntelligenceController],
  providers: [PriceIntelligenceService, PriceIngestionService, PriceIntelligenceEngine, PriceIntelligenceRepository, PriceAdminService],
  exports: [PriceIntelligenceService, PriceIngestionService, PriceIntelligenceEngine, PriceIntelligenceRepository, PriceAdminService],
})
export class PriceIntelligenceModule {}
