export type ExportJobType = 'meal_plan_pdf' | 'shopping_list_print';

export type ExportJobView = {
  id: string;
  type: ExportJobType;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result?: { storageKey?: string; fileName?: string; kind?: string } | null;
  errorCode?: string | null;
};

export type ShareAdapter = { channel: string; url: string };

export type ShareLinkView = {
  id: string;
  token: string;
  exportJobId: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type SignedDownloadView = {
  storageKey: string;
  expiresAt: number;
  signature: string;
  path: string;
};
