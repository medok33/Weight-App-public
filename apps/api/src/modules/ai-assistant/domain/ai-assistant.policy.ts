import type { AIIntent, PromptVersion } from './ai-assistant.types';
export function minimizeHealthData(input: Record<string, unknown>) { const safe = { ...input }; for (const key of ['email', 'name', 'phone', 'address']) delete safe[key]; return safe; }
export function isAllowedIntent(intent: string): intent is AIIntent { return intent === 'meal_explanation' || intent === 'habit_coach'; }
export function renderPrompt(prompt: PromptVersion, data: Record<string, unknown>) { if (!isAllowedIntent(prompt.intent)) throw new Error('AI_INTENT_FORBIDDEN'); return `${prompt.template}\n${JSON.stringify(minimizeHealthData(data))}`; }
export function detectInjection(input: string) { return /ignore previous|reveal system prompt|bypass safety/i.test(input); }
