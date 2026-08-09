export type PartnerPriceFeed = { partnerId: string; fetchPrices: () => Promise<unknown[]> };
export type IntegrationAdapter = { providerId: string; capabilities: string[]; connect: (input: unknown) => Promise<{ token: string; scopes?: string[] }>; disconnect: () => Promise<void>; refreshToken: () => Promise<void>; sync: () => Promise<unknown>; handleWebhook: (raw: string) => Promise<unknown>; health: () => Promise<boolean> };
export class InMemoryNullAdapter implements IntegrationAdapter {
  constructor(public providerId: string, public capabilities: string[] = []) {}
  async connect() { return { token: 'test-token', scopes: [] }; } async disconnect() {} async refreshToken() {} async sync() { return {}; } async handleWebhook() { return {}; } async health() { return true; }
}
