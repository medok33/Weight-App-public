import { Module } from '@nestjs/common';
import { AuditSecurityModule } from '../audit-security/audit-security.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { IntegrationsService } from './application/integrations.service';
import { IntegrationsRepository } from './infrastructure/integrations.repository';
import { IntegrationsController } from './controllers/integrations.controller';
@Module({ imports: [DatabaseModule, AuthModule, AuditSecurityModule], controllers: [IntegrationsController], providers: [IntegrationsService, IntegrationsRepository], exports: [IntegrationsService] }) export class IntegrationsModule {}
