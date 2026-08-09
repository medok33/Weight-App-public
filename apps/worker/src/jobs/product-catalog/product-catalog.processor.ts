import type { ProductCatalogJob } from './product-catalog.job';
export function processProductCatalogJob(job: ProductCatalogJob) { return { idempotencyKey: job.idempotencyKey, imported: job.products.length, status: 'completed' as const }; }
