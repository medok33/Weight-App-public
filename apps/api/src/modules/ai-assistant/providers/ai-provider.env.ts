/** Centralized AI env reads — never log apiKey values. */

export type DeepSeekConfig = {
  apiKey: string;
  model: string;
  freeModel: string;
  premiumModel: string;
  freeThinking: 'enabled' | 'disabled';
  premiumThinking: 'enabled' | 'disabled';
  reasoningEffort: 'high' | 'max';
  baseUrl: string;
  configured: boolean;
};

export type OpenAIConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  configured: boolean;
};

export type LocalLlmConfig = {
  baseUrl: string;
  model: string;
  configured: boolean;
};

export type AIProviderKind = 'local' | 'deepseek' | 'openai' | 'local-llm';

export type AIProviderPublicStatus = {
  configured: boolean;
  selectedProvider: AIProviderKind;
  freeModel: string;
  premiumModel: string;
  freeThinking: 'enabled' | 'disabled';
  premiumThinking: 'enabled' | 'disabled';
  reasoningEffort: 'high' | 'max';
  apiKey: 'configured' | 'not configured';
};

export function readAIProviderKind(): AIProviderKind {
  const raw = (process.env.AI_PROVIDER ?? 'local').toLowerCase();
  if (raw === 'deepseek' || raw === 'openai' || raw === 'local-llm') return raw;
  return 'local';
}

function thinkingFromEnv(name: string, fallback: 'enabled' | 'disabled'): 'enabled' | 'disabled' {
  const value = (process.env[name] ?? '').trim().toLowerCase();
  if (value === 'enabled' || value === 'disabled') return value;
  return fallback;
}

export function readDeepSeekConfig(): DeepSeekConfig {
  const apiKey = (process.env.DEEPSEEK_API_KEY ?? process.env.AI_DEEPSEEK_API_KEY ?? '').trim();
  const freeModel = process.env.DEEPSEEK_FREE_MODEL?.trim() || 'deepseek-v4-flash';
  const premiumModel = process.env.DEEPSEEK_PREMIUM_MODEL?.trim() || 'deepseek-v4-pro';
  const model = process.env.DEEPSEEK_MODEL?.trim() || freeModel;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? process.env.AI_DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(
    /\/$/,
    '',
  );
  return {
    apiKey,
    model,
    freeModel,
    premiumModel,
    freeThinking: thinkingFromEnv('DEEPSEEK_FREE_THINKING', 'disabled'),
    premiumThinking: thinkingFromEnv('DEEPSEEK_PREMIUM_THINKING', 'enabled'),
    reasoningEffort: process.env.DEEPSEEK_REASONING_EFFORT === 'max' ? 'max' : 'high',
    baseUrl,
    configured: apiKey.length > 0,
  };
}

export function readOpenAIConfig(): OpenAIConfig {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  return { apiKey, model, baseUrl, configured: apiKey.length > 0 };
}

export function readLocalLlmConfig(): LocalLlmConfig {
  const baseUrl = (process.env.LOCAL_LLM_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
  const model = process.env.LOCAL_LLM_MODEL ?? 'llama3';
  const configured = Boolean(process.env.LOCAL_LLM_BASE_URL?.trim());
  return { baseUrl, model, configured };
}

export function describeProviderPublicStatus(): AIProviderPublicStatus {
  const selectedProvider = readAIProviderKind();
  const deepseek = readDeepSeekConfig();
  let configured = true;
  let apiKey: 'configured' | 'not configured' = 'not configured';
  if (selectedProvider === 'deepseek') {
    configured = deepseek.configured;
    apiKey = deepseek.configured ? 'configured' : 'not configured';
  } else if (selectedProvider === 'openai') {
    const openai = readOpenAIConfig();
    configured = openai.configured;
    apiKey = openai.configured ? 'configured' : 'not configured';
  } else if (selectedProvider === 'local-llm') {
    configured = readLocalLlmConfig().configured;
    apiKey = 'not configured';
  } else {
    configured = true;
    apiKey = 'not configured';
  }
  return {
    configured,
    selectedProvider,
    freeModel: deepseek.freeModel,
    premiumModel: deepseek.premiumModel,
    freeThinking: deepseek.freeThinking,
    premiumThinking: deepseek.premiumThinking,
    reasoningEffort: deepseek.reasoningEffort,
    apiKey,
  };
}

export function resolveAIProviderStartupStatus(): 'enabled' | 'disabled' {
  switch (readAIProviderKind()) {
    case 'deepseek':
      return readDeepSeekConfig().configured ? 'enabled' : 'disabled';
    case 'openai':
      return readOpenAIConfig().configured ? 'enabled' : 'disabled';
    case 'local-llm':
      return readLocalLlmConfig().configured ? 'enabled' : 'disabled';
    default:
      return 'enabled';
  }
}

/** Logs provider readiness at boot — never prints secrets. */
export function logAIProviderStartupStatus(): void {
  const status = describeProviderPublicStatus();
  console.log(
    `AI provider status: selected=${status.selectedProvider} configured=${status.configured} apiKey=${status.apiKey} free=${status.freeModel} premium=${status.premiumModel}`,
  );
}
