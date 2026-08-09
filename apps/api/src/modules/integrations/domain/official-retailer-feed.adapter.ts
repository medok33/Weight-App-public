import { assertOutboundAllowlisted } from './integrations.policy';

export type OfficialRetailerFeedAdapter = {
  providerId: string;
  termsVersion: string;
  authMode: 'oauth' | 'api_key' | 'none';
  fetchPage(cursor?: string): Promise<{ observations: unknown[]; nextCursor?: string }>;
  mapToObservations(payload: unknown): Array<{ externalId: string; priceMinor: number; currency: string }>;
  health(): { status: 'ready' | 'disabled' | 'contract_only' };
  disable(reason: string): void;
};

/** Sandbox-only contract fixture. It is never an official retailer integration. */
export class SandboxOfficialFeedAdapter implements OfficialRetailerFeedAdapter {
  readonly termsVersion = 'sandbox-contract-v1';
  readonly authMode = 'none' as const;
  private disabled = false;
  constructor(readonly providerId = 'sandbox-official-feed') {}
  async fetchPage(cursor?: string) { return { observations: cursor ? [] : [{ id: 'sandbox-1', priceMinor: 19900, currency: 'RUB' }] }; }
  mapToObservations(payload: unknown) {
    if (!Array.isArray(payload)) throw new Error('OFFICIAL_FEED_PAYLOAD_INVALID');
    return payload.map((item: { id?: string; priceMinor?: number; currency?: string }) => {
      if (!item?.id || !Number.isInteger(item.priceMinor) || !/^[A-Z]{3}$/.test(item.currency ?? '')) throw new Error('OFFICIAL_FEED_PAYLOAD_INVALID');
      return { externalId: String(item.id), priceMinor: item.priceMinor as number, currency: item.currency as string };
    });
  }
  health() { return { status: this.disabled ? 'disabled' : 'contract_only' } as const; }
  disable(reason: string) { void reason; this.disabled = true; }
}

export function evaluateOfficialFeedReadiness(providerId: string, registry: Array<{ providerId: string; officialDocsUrl?: string }>) {
  const registered = registry.find((provider) => provider.providerId === providerId);
  return process.env.OFFICIAL_RETAILER_FEED_ENABLED === 'true' && registered?.officialDocsUrl
    ? { status: 'READY' as const }
    : { status: 'PARTIAL' as const, reason: 'OFFICIAL_RETAILER_FEED_ACCESS_REQUIRED' };
}
export function officialFeedUrl(url: string, allowedHosts: string[]) { return assertOutboundAllowlisted(url, allowedHosts); }
