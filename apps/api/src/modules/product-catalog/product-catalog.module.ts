import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import {
  ProductAliasResolver,
  ProductFoundationRepository,
  ProductNutritionResolver,
  ProductRestrictionResolver,
} from './application/product-foundation.resolvers';
import {
  ProductCulinaryRoleResolver,
  ProductPriceResolver,
  ProductSubstitutionResolver,
  RetailProductRepository,
} from './application/product-roles-retail.resolvers';
import { ProductCatalogService } from './application/product-catalog.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    ProductCatalogService,
    ProductFoundationRepository,
    ProductAliasResolver,
    ProductNutritionResolver,
    ProductRestrictionResolver,
    ProductCulinaryRoleResolver,
    ProductSubstitutionResolver,
    RetailProductRepository,
    ProductPriceResolver,
  ],
  exports: [
    ProductCatalogService,
    ProductFoundationRepository,
    ProductAliasResolver,
    ProductNutritionResolver,
    ProductRestrictionResolver,
    ProductCulinaryRoleResolver,
    ProductSubstitutionResolver,
    RetailProductRepository,
    ProductPriceResolver,
  ],
})
export class ProductCatalogModule {}
