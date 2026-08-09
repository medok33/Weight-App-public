export type ExportLocale = 'ru' | 'en';

export type PlanExportDay = {
  dayLabel: string;
  mealName: string;
  calories: number | null;
  proteinG: number | null;
};

/** User-facing plan snapshot — no internal IDs or technical keys. */
export type PlanExportDocument = {
  locale: ExportLocale;
  title: string;
  displayName: string | null;
  version: number;
  targetKcal: number | null;
  days: PlanExportDay[];
};

export type ShoppingPrintItem = {
  name: string;
  quantity: number;
  unit: string;
  estimatedCost: number | null;
};

/** User-facing shopping snapshot — no productId / retailer codes. */
export type ShoppingPrintDocument = {
  locale: ExportLocale;
  title: string;
  items: ShoppingPrintItem[];
  weekCost: number | null;
  currency: string;
};

export type StoredExportObject = {
  storageKey: string;
  contentType: string;
  byteLength: number;
  fileName: string;
};

export type SignedDownload = {
  storageKey: string;
  expiresAt: number;
  signature: string;
  path: string;
};

export type ShareChannel = 'telegram' | 'vk' | 'whatsapp' | 'email';

export type ShareLinkRecord = {
  id: string;
  token: string;
  exportJobId: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export type ShareAdapterResult = {
  channel: ShareChannel;
  url: string;
};
