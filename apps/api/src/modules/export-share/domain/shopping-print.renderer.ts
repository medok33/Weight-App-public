import type { ExportLocale, ShoppingPrintDocument } from './export-document.types';

export function buildShoppingPrintDocument(input: {
  locale: ExportLocale;
  items: Array<{ name?: string; quantity?: number; unit?: string; estimatedCost?: number | null }>;
  weekCost?: number | null;
  currency?: string;
}): ShoppingPrintDocument {
  const locale = input.locale;
  return {
    locale,
    title: locale === 'ru' ? 'Список покупок' : 'Shopping list',
    items: (input.items ?? []).map((item) => ({
      name: item.name?.trim() || (locale === 'ru' ? 'Товар' : 'Item'),
      quantity: typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 0,
      unit: item.unit?.trim() || '',
      estimatedCost:
        typeof item.estimatedCost === 'number' && Number.isFinite(item.estimatedCost) ? item.estimatedCost : null,
    })),
    weekCost: typeof input.weekCost === 'number' && Number.isFinite(input.weekCost) ? input.weekCost : null,
    currency: input.currency?.trim() || 'RUB',
  };
}

export function renderShoppingListHtml(doc: ShoppingPrintDocument): string {
  const rows = doc.items.length
    ? doc.items
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity} ${escapeHtml(item.unit)}</td><td>${
              item.estimatedCost != null ? `${item.estimatedCost} ${escapeHtml(doc.currency)}` : '—'
            }</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="3">${doc.locale === 'ru' ? 'Список пуст' : 'List is empty'}</td></tr>`;
  const total =
    doc.weekCost != null
      ? `<p>${doc.locale === 'ru' ? 'Итого за неделю' : 'Week total'}: ${doc.weekCost} ${escapeHtml(doc.currency)}</p>`
      : '';
  return `<!doctype html><html lang="${doc.locale}"><head><meta charset="utf-8"/><title>${escapeHtml(
    doc.title,
  )}</title><style>
  body{font-family:system-ui,sans-serif;margin:24px;color:#111}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ccc;padding:8px;text-align:left}
  @media print{button{display:none}}
  </style></head><body>
  <h1>${escapeHtml(doc.title)}</h1>
  ${total}
  <table><thead><tr><th>${doc.locale === 'ru' ? 'Продукт' : 'Product'}</th><th>${
    doc.locale === 'ru' ? 'Кол-во' : 'Qty'
  }</th><th>${doc.locale === 'ru' ? 'Оценка' : 'Estimate'}</th></tr></thead><tbody>${rows}</tbody></table>
  <button onclick="window.print()">${doc.locale === 'ru' ? 'Печать' : 'Print'}</button>
  </body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
