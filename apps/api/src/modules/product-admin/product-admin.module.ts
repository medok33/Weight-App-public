import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditSecurityModule } from '../audit-security/audit-security.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ProductCatalogModule } from '../product-catalog/product-catalog.module';
import { RecipePlatformModule } from '../recipe-platform/recipe-platform.module';
import { ProductAdminService } from './application/product-admin.service';
import { ProductAdminController } from './controllers/product-admin.controller';
import { ProductAdminRepository } from './infrastructure/product-admin.repository';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AuditSecurityModule,
    ProductCatalogModule,
    forwardRef(() => RecipePlatformModule),
  ],
  controllers: [ProductAdminController],
  providers: [ProductAdminService, ProductAdminRepository],
  exports: [ProductAdminService],
})
export class ProductAdminModule {}
