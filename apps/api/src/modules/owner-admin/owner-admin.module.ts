import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OwnerAdminService } from './application/owner-admin.service';
import { OwnerAdminController } from './controllers/owner-admin.controller';
import { OwnerAdminRepository } from './infrastructure/owner-admin.repository';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [OwnerAdminController],
  providers: [OwnerAdminService, OwnerAdminRepository],
  exports: [OwnerAdminService],
})
export class OwnerAdminModule {}
