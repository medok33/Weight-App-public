import { Module } from '@nestjs/common';
import { AuditSecurityModule } from '../audit-security/audit-security.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { FamilyModeService } from './application/family-mode.service';
import { FamilyModeController } from './controllers/family-mode.controller';
import { FamilyModeRepository } from './infrastructure/family-mode.repository';

@Module({
  imports: [DatabaseModule, AuthModule, AuditSecurityModule],
  controllers: [FamilyModeController],
  providers: [FamilyModeService, FamilyModeRepository],
  exports: [FamilyModeService],
})
export class FamilyModeModule {}
