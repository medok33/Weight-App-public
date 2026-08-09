import type { Product } from '../domain/product-catalog.types';
export class ProductCatalogRepository { private readonly products: Product[] = []; save(product: Product) { this.products.push(product); return product; } findByAlias(alias: string) { return this.products.find((product) => product.aliases?.includes(alias)); } }
