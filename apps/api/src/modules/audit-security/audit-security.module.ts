import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuditSecurityService } from './application/audit-security.service';
import { AuditSecurityRepository } from './infrastructure/audit-security.repository';
import { BackupObjectStorage } from './infrastructure/backup-object-storage';
import { AuditSecurityController } from './controllers/audit-security.controller';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AuditSecurityController],
  providers: [AuditSecurityService, AuditSecurityRepository, BackupObjectStorage],
  exports: [AuditSecurityService],
})
export class AuditSecurityModule {}
