/** Approximate USD cost per 1M tokens for usage estimates (not billing). */

const FLASH_INPUT = 0.14;
const FLASH_OUTPUT = 0.28;
const PRO_INPUT = 1.1;
const PRO_OUTPUT = 4.4;

export function estimateDeepSeekCostUsd(input: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number {
  const isPro = /v4-pro|reasoner/i.test(input.model);
  const inputRate = isPro ? PRO_INPUT : FLASH_INPUT;
  const outputRate = isPro ? PRO_OUTPUT : FLASH_OUTPUT;
  const cost =
    (input.promptTokens * inputRate + input.completionTokens * outputRate) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
