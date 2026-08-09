/** AI subscription tariffs — no real billing wiring required for this layer. */

export type AITariffTier = 'FREE' | 'PREMIUM';

export type AIQuotaMode = 'LIMITED' | 'UNLIMITED';

export type AIThinkingMode = 'enabled' | 'disabled';

export type AITariffConfig = {
  tier: AITariffTier;
  model: string;
  dailyRequestLimit: number | null;
  entitlementKey: string | null;
  thinking: AIThinkingMode;
  reasoningEffort?: 'high' | 'max';
  quotaMode: AIQuotaMode;
  /** True when accountRole=OWNER — full access, never daily-blocked. */
  ownerUnlimited?: boolean;
};

function envModel(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function envThinking(name: string, fallback: AIThinkingMode): AIThinkingMode {
  const value = (process.env[name] ?? '').trim().toLowerCase();
  if (value === 'enabled' || value === 'disabled') return value;
  return fallback;
}

/** Resolved at call time so env overrides apply without process restart in tests. */
export function getTariffConfig(tier: AITariffTier, options?: { ownerUnlimited?: boolean }): AITariffConfig {
  if (options?.ownerUnlimited) {
    return {
      tier: 'PREMIUM',
      model: envModel('DEEPSEEK_PREMIUM_MODEL', 'deepseek-v4-pro'),
      dailyRequestLimit: null,
      entitlementKey: 'ai.premium',
      thinking: envThinking('DEEPSEEK_PREMIUM_THINKING', 'enabled'),
      reasoningEffort: (process.env.DEEPSEEK_REASONING_EFFORT === 'max' ? 'max' : 'high') as 'high' | 'max',
      quotaMode: 'UNLIMITED',
      ownerUnlimited: true,
    };
  }

  if (tier === 'PREMIUM') {
    return {
      tier: 'PREMIUM',
      model: envModel('DEEPSEEK_PREMIUM_MODEL', 'deepseek-v4-pro'),
      dailyRequestLimit: 30,
      entitlementKey: 'ai.premium',
      thinking: envThinking('DEEPSEEK_PREMIUM_THINKING', 'enabled'),
      reasoningEffort: (process.env.DEEPSEEK_REASONING_EFFORT === 'max' ? 'max' : 'high') as 'high' | 'max',
      quotaMode: 'LIMITED',
    };
  }
  return {
    tier: 'FREE',
    model: envModel('DEEPSEEK_FREE_MODEL', 'deepseek-v4-flash'),
    dailyRequestLimit: 20,
    entitlementKey: null,
    thinking: envThinking('DEEPSEEK_FREE_THINKING', 'disabled'),
    quotaMode: 'LIMITED',
  };
}

/** Static snapshot for docs/tests — mirrors defaults without env overrides. */
export const AI_TARIFFS: Record<AITariffTier, AITariffConfig> = {
  FREE: {
    tier: 'FREE',
    model: 'deepseek-v4-flash',
    dailyRequestLimit: 20,
    entitlementKey: null,
    thinking: 'disabled',
    quotaMode: 'LIMITED',
  },
  PREMIUM: {
    tier: 'PREMIUM',
    model: 'deepseek-v4-pro',
    dailyRequestLimit: 30,
    entitlementKey: 'ai.premium',
    thinking: 'enabled',
    reasoningEffort: 'high',
    quotaMode: 'LIMITED',
  },
};

export const PREMIUM_ENTITLEMENT_KEY = 'ai.premium';

/** Legacy aliases retired after DeepSeek V4 migration — must not appear in runtime routing. */
export const RETIRED_DEEPSEEK_ALIASES = ['deepseek-chat', 'deepseek-reasoner'] as const;

export type QuotaView = {
  quotaMode: AIQuotaMode;
  limit: number | null;
  used: number;
  remaining: number | null;
};

export function toQuotaView(tariff: AITariffConfig, used: number): QuotaView {
  if (tariff.quotaMode === 'UNLIMITED' || tariff.dailyRequestLimit == null) {
    return { quotaMode: 'UNLIMITED', limit: null, used, remaining: null };
  }
  return {
    quotaMode: 'LIMITED',
    limit: tariff.dailyRequestLimit,
    used,
    remaining: Math.max(0, tariff.dailyRequestLimit - used),
  };
}
