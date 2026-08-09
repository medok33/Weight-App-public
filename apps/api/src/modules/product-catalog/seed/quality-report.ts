import { buildCatalogCoreV2Manifest } from './catalog-core-v2.dataset';
import { buildCatalogCoreV3Manifest } from './catalog-core-v3.dataset';
import { buildPilotManifest } from './pilot-v1.dataset';
import { validateManifest } from './validate-manifest';

export function productDataQualityReport(
  dataset: 'pilot-v1' | 'catalog-core-v2' | 'catalog-core-v3' = 'catalog-core-v3',
) {
  const manifest =
    dataset === 'pilot-v1'
      ? buildPilotManifest()
      : dataset === 'catalog-core-v2'
        ? buildCatalogCoreV2Manifest()
        : buildCatalogCoreV3Manifest();
  const rejected = validateManifest(manifest);
  return {
    total: manifest.productCount,
    invalid: rejected.length,
    status: rejected.length === 0 ? ('pass' as const) : ('fail' as const),
    datasetVersion: manifest.datasetVersion,
    checksum: manifest.checksum,
    rejected: rejected.slice(0, 20),
  };
}
