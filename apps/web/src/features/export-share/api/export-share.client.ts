import type {
  ExportJobType,
  ExportJobView,
  ShareAdapter,
  ShareLinkView,
  SignedDownloadView,
} from '../model/export-share.types';

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 401 || response.status === 403) throw new Error('FORBIDDEN');
  if (!response.ok) throw new Error('EXPORT_REQUEST_FAILED');
  return response.json() as Promise<T>;
}

export async function listExportJobs() {
  const r = await fetch('/api/export-share/jobs', { cache: 'no-store' });
  return readJson<ExportJobView[]>(r);
}

export async function createExportJob(type: ExportJobType, idempotencyKey: string) {
  const r = await fetch('/api/export-share/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, idempotencyKey }),
    cache: 'no-store',
  });
  return readJson<ExportJobView>(r);
}

export async function getExportJob(id: string) {
  const r = await fetch(`/api/export-share/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' });
  return readJson<ExportJobView>(r);
}

export async function getDownloadLink(id: string) {
  const r = await fetch(`/api/export-share/jobs/${encodeURIComponent(id)}/download-link`, {
    method: 'POST',
    cache: 'no-store',
  });
  return readJson<SignedDownloadView>(r);
}

export async function getShareAdapters(id: string) {
  const r = await fetch(`/api/export-share/jobs/${encodeURIComponent(id)}/share-adapters`, {
    headers: { 'x-public-base-url': typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000' },
    cache: 'no-store',
  });
  return readJson<ShareAdapter[]>(r);
}

export async function createShareLink(id: string, ttlMinutes = 60) {
  const r = await fetch(`/api/export-share/jobs/${encodeURIComponent(id)}/share-links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ttlMinutes }),
    cache: 'no-store',
  });
  return readJson<ShareLinkView>(r);
}

export async function revokeShareLink(linkId: string) {
  const r = await fetch(`/api/export-share/share-links/${encodeURIComponent(linkId)}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
  return readJson<ShareLinkView>(r);
}
