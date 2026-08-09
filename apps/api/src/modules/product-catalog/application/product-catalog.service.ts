import { canonicalizeAlias, validateProduct } from '../domain/product-catalog.policy';
import type { Product } from '../domain/product-catalog.types';
import { ProductCatalogRepository } from '../infrastructure/product-catalog.repository';
export class ProductCatalogService { constructor(private readonly repository = new ProductCatalogRepository()) {} register(product: Product) { return this.repository.save(validateProduct(product)); } resolveAlias(alias: string) { return this.repository.findByAlias(canonicalizeAlias(alias)); } }
