'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createProduct,
  getAdminMeta,
  getPriceReview,
  importCatalogCsv,
  listObservations,
  listProducts,
  listRetailers,
  syncMockApi,
  updateProduct,
  updateRetailer,
  validateCatalogCsv,
} from '../api/price-intelligence.client';
import type {
  CsvValidationResult,
  ImportReport,
  ObservationAdminView,
  PriceReview,
  ProductAdminView,
  RetailerAdminView,
} from '../model/price-intelligence.types';
import { useI18n } from '../../../i18n/locale-provider';
import type { AdminMessageKey } from '../../../i18n/admin-message-keys';

type Tab = 'import' | 'retailers' | 'products' | 'observations' | 'review';
type ScreenState = 'loading' | 'forbidden' | 'error' | 'success';

const TAB_KEYS: Record<Tab, AdminMessageKey> = {
  import: 'admin.price.tabs.import',
  retailers: 'admin.price.tabs.retailers',
  products: 'admin.price.tabs.products',
  observations: 'admin.price.tabs.observations',
  review: 'admin.price.tabs.review',
};

const DEFAULT_CATALOG =
  'product_key,name,category,weight,price,retailer,retailer_code\nchicken_breast,Куриная грудка,protein,500g,299,Магнит,MAGNIT\n';

export function PriceIntelligenceScreen() {
  const { t } = useI18n();
  const isNonProd = process.env.NODE_ENV !== 'production';
  const [state, setState] = useState<ScreenState>('loading');
  const [tab, setTab] = useState<Tab>('import');
  const [review, setReview] = useState<PriceReview | null>(null);
  const [retailers, setRetailers] = useState<RetailerAdminView[]>([]);
  const [products, setProducts] = useState<ProductAdminView[]>([]);
  const [observations, setObservations] = useState<ObservationAdminView[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [catalogCsv, setCatalogCsv] = useState(DEFAULT_CATALOG);
  const [validation, setValidation] = useState<CsvValidationResult | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [message, setMessage] = useState('');
  const [newProduct, setNewProduct] = useState({ productKey: '', name: '', category: 'other', unit: 'g' });

  const loadAdmin = useCallback(async () => {
    const [meta, retailerData, productData, observationData] = await Promise.all([
      getAdminMeta(),
      listRetailers(),
      listProducts(),
      listObservations(),
    ]);
    setCategories(meta.categories);
    setUnits(meta.units);
    setRetailers(retailerData.items);
    setProducts(productData.items);
    setObservations(observationData.items);
  }, []);

  useEffect(() => {
    Promise.all([getPriceReview().catch(() => null), loadAdmin()])
      .then(([reviewData]) => {
        if (reviewData) setReview(reviewData);
        setState('success');
      })
      .catch((error: unknown) =>
        setState(error instanceof Error && error.message === 'PRICE_ACCESS_FORBIDDEN' ? 'forbidden' : 'error'),
      );
  }, [loadAdmin]);

  async function onValidateCatalog() {
    try {
      const result = await validateCatalogCsv(catalogCsv);
      setValidation(result);
      setMessage(result.valid ? `OK: ${result.validRowCount}` : `Ошибки: ${result.errors.length}`);
    } catch {
      setMessage('Ошибка валидации');
    }
  }

  async function onImportCatalog() {
    try {
      const result = await importCatalogCsv(catalogCsv, 'Импорт CSV');
      setImportReport(result);
      setValidation(result.validation ?? null);
      setMessage(
        `+${result.productsCreated} / ${result.productsUpdated} / ${result.pricesImported}`,
      );
      await loadAdmin();
    } catch {
      setMessage('Импорт не удался');
    }
  }

  async function onToggleRetailer(retailer: RetailerAdminView) {
    await updateRetailer(retailer.id, { active: !retailer.active });
    await loadAdmin();
  }

  async function onCreateProduct(event: React.FormEvent) {
    event.preventDefault();
    await createProduct(newProduct);
    setNewProduct({ productKey: '', name: '', category: 'other', unit: 'g' });
    await loadAdmin();
    setMessage(t('admin.price.products.create'));
  }

  if (state === 'loading') {
    return (
      <main aria-busy="true">
        <h1>{t('admin.price.title')}</h1>
        <p>{t('admin.price.loading')}</p>
      </main>
    );
  }

  if (state === 'error') {
    return (
      <main role="alert">
        <h1>{t('admin.price.title')}</h1>
        <p>{t('admin.price.unavailable')}</p>
      </main>
    );
  }

  return (
    <main>
      <h1 data-testid="price-intel-heading">{t('admin.price.title')}</h1>
      {state === 'forbidden' ? <p role="status">{t('admin.price.mfaReview')}</p> : null}

      <nav aria-label={t('admin.price.title')} data-testid="price-admin-tabs">
        {(['import', 'retailers', 'products', 'observations', 'review'] as Tab[]).map((item) => (
          <button key={item} type="button" data-testid={`price-tab-${item}`} onClick={() => setTab(item)} aria-pressed={tab === item}>
            {t(TAB_KEYS[item])}
          </button>
        ))}
      </nav>

      {tab === 'import' && (
        <section data-testid="price-import-section">
          <h2>{t('admin.price.import.title')}</h2>
          <p>{t('admin.price.import.columns')}</p>
          <textarea
            aria-label={t('admin.price.import.title')}
            data-testid="price-catalog-csv"
            value={catalogCsv}
            onChange={(e) => setCatalogCsv(e.target.value)}
            rows={8}
          />
          <div>
            <button type="button" data-testid="price-validate-catalog" onClick={onValidateCatalog}>
              {t('admin.price.import.validate')}
            </button>
            <button type="button" data-testid="price-import-catalog" onClick={onImportCatalog}>
              {t('admin.price.import.import')}
            </button>
          </div>
          {validation ? (
            <div data-testid="price-validation-report">
              <p>
                {validation.rowCount} / {validation.validRowCount}
                {validation.missingColumns.length ? ` · ${validation.missingColumns.join(', ')}` : ''}
              </p>
              {validation.errors.length > 0 ? (
                <ul data-testid="price-validation-errors">
                  {validation.errors.map((err) => (
                    <li key={`${err.line}-${err.field ?? ''}-${err.message}`}>
                      {err.line}: {err.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {importReport ? (
            <div data-testid="price-import-report">
              <p>
                {importReport.productsCreated} / {importReport.productsUpdated} / {importReport.pricesImported}
              </p>
            </div>
          ) : null}
          {isNonProd ? (
            <>
              <h3>{t('admin.price.import.otherSources')}</h3>
              <p role="status">{t('admin.price.import.mockWarning')}</p>
              <button
                type="button"
                data-testid="price-sync-mock-api"
                onClick={() =>
                  syncMockApi()
                    .then((r) => setMessage(String(r.imported)))
                    .catch(() => setMessage('—'))
                }
              >
                {t('admin.price.import.syncMock')}
              </button>
            </>
          ) : null}
        </section>
      )}

      {tab === 'retailers' && (
        <section data-testid="price-retailers-section">
          <h2>{t('admin.price.retailers.title')}</h2>
          {retailers.length === 0 ? (
            <p>{t('admin.price.retailers.empty')}</p>
          ) : (
            <table aria-label={t('admin.price.retailers.title')}>
              <thead>
                <tr>
                  <th scope="col">{t('admin.price.retailers.code')}</th>
                  <th scope="col">{t('admin.price.retailers.name')}</th>
                  <th scope="col">{t('admin.price.retailers.region')}</th>
                  <th scope="col">{t('admin.price.retailers.active')}</th>
                  <th scope="col">
                    <span className="sr-only">{t('admin.common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {retailers.map((retailer) => (
                  <tr key={retailer.id} data-testid={`retailer-row-${retailer.code}`}>
                    <td>{retailer.code}</td>
                    <td>{retailer.name}</td>
                    <td>
                      <input
                        aria-label={t('admin.price.retailers.region')}
                        value={retailer.region}
                        onChange={(e) =>
                          setRetailers((items) =>
                            items.map((r) => (r.id === retailer.id ? { ...r, region: e.target.value } : r)),
                          )
                        }
                        onBlur={() => updateRetailer(retailer.id, { region: retailer.region }).then(loadAdmin)}
                      />
                    </td>
                    <td>{retailer.active ? t('admin.common.yes') : t('admin.common.no')}</td>
                    <td>
                      <button type="button" data-testid={`retailer-toggle-${retailer.code}`} onClick={() => onToggleRetailer(retailer)}>
                        {retailer.active ? t('admin.price.retailers.toggleOff') : t('admin.price.retailers.toggleOn')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'products' && (
        <section data-testid="price-products-section">
          <h2>{t('admin.price.products.title')}</h2>
          <form onSubmit={onCreateProduct} data-testid="price-product-form">
            <input
              placeholder={t('admin.product.productKey')}
              data-testid="product-key-input"
              value={newProduct.productKey}
              onChange={(e) => setNewProduct((p) => ({ ...p, productKey: e.target.value }))}
              required
            />
            <input
              placeholder={t('admin.product.canonicalName')}
              data-testid="product-name-input"
              value={newProduct.name}
              onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
              required
            />
            <select
              data-testid="product-category-select"
              value={newProduct.category}
              onChange={(e) => setNewProduct((p) => ({ ...p, category: e.target.value }))}
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <select
              data-testid="product-unit-select"
              value={newProduct.unit}
              onChange={(e) => setNewProduct((p) => ({ ...p, unit: e.target.value }))}
            >
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
            <button type="submit" data-testid="product-create-btn">
              {t('admin.price.products.create')}
            </button>
          </form>
          <ul data-testid="price-product-list">
            {products.map((product) => (
              <li key={product.id} data-testid={`product-row-${product.productKey}`}>
                <strong>{product.name}</strong> ({product.category}, {product.unit})
                <button
                  type="button"
                  onClick={() =>
                    updateProduct(product.id, { category: product.category === 'other' ? 'protein' : 'other' }).then(loadAdmin)
                  }
                >
                  {t('admin.price.products.changeCategory')}
                </button>
                <details>
                  <summary>{t('admin.common.technicalDetails')}</summary>
                  {product.productKey} · {product.id}
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'observations' && (
        <section data-testid="price-observations-section">
          <h2>{t('admin.price.observations.title')}</h2>
          {observations.length === 0 ? (
            <p>{t('admin.price.observations.empty')}</p>
          ) : (
            <table aria-label={t('admin.price.observations.title')}>
              <thead>
                <tr>
                  <th scope="col">{t('admin.price.observations.product')}</th>
                  <th scope="col">{t('admin.price.observations.retailer')}</th>
                  <th scope="col">{t('admin.price.observations.price')}</th>
                  <th scope="col">{t('admin.price.observations.source')}</th>
                  <th scope="col">{t('admin.price.observations.date')}</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((obs) => (
                  <tr key={obs.id} data-testid={`observation-row-${obs.id}`}>
                    <td>{obs.productName}</td>
                    <td>{obs.retailerName ?? obs.retailerCode ?? '—'}</td>
                    <td>
                      {obs.price} {obs.currency}
                    </td>
                    <td>{obs.sourceName ?? obs.sourceType}</td>
                    <td>{obs.collectedAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'review' && (
        <section>
          <h2>{t('admin.price.review.title')}</h2>
          {review?.items.length ? (
            <ul>
              {review.items.map((item) => (
                <li key={item.id}>
                  {item.productId}: {item.price}
                  <details>
                    <summary>{t('admin.common.technicalDetails')}</summary>
                    {item.sourceType ?? item.source} · {item.sourceName ?? '—'}
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('admin.price.review.empty')}</p>
          )}
        </section>
      )}

      {message ? (
        <p role="status" data-testid="price-intel-status">
          {message}
        </p>
      ) : null}
    </main>
  );
}
