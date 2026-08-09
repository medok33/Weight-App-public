import type { AIProviderAdapter } from '../domain/ai-provider.interface';
import { readAIProviderKind } from './ai-provider.env';
import { DeepSeekProvider } from './deepseek.provider';
import { LocalLlmProvider } from './local-llm.provider';
import { LocalProvider } from './local.provider';
import { OpenAIProvider } from './openai.provider';

export type { AIProviderKind } from './ai-provider.env';

export function createAIProvider(kind?: string): AIProviderAdapter {
  const selected = (kind ?? readAIProviderKind()).toLowerCase();
  switch (selected) {
    case 'deepseek':
      return new DeepSeekProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'local-llm':
      return new LocalLlmProvider();
    default:
      return new LocalProvider();
  }
}

export function describeActiveProvider(): { kind: string; configured: boolean } {
  const kind = readAIProviderKind();
  const provider = createAIProvider(kind);
  const configured = 'configured' in provider ? Boolean((provider as { configured: boolean }).configured) : true;
  return { kind, configured: kind === 'local' ? true : configured };
}
