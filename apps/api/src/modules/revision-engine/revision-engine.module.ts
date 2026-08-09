import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuditSecurityModule } from '../audit-security/audit-security.module';
import { ShoppingListModule } from '../shopping-list/shopping-list.module';
import { RevisionEngineService } from './application/revision-engine.service';
import { RevisionEngineController } from './controllers/revision-engine.controller';
import { RevisionEngineRepository } from './infrastructure/revision-engine.repository';

@Module({
  imports: [DatabaseModule, AuditSecurityModule, forwardRef(() => ShoppingListModule)],
  controllers: [RevisionEngineController],
  providers: [RevisionEngineService, RevisionEngineRepository],
  exports: [RevisionEngineService, RevisionEngineRepository],
})
export class RevisionEngineModule {}
