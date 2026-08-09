export type ProductCatalogJob = { idempotencyKey: string; products: unknown[] };
export function createProductCatalogJob(products: unknown[], idempotencyKey: string): ProductCatalogJob { if (!idempotencyKey) throw new Error('PRODUCT_JOB_IDEMPOTENCY_REQUIRED'); return { products, idempotencyKey }; }
