/** Shared transport error mapping for fixture-backed adapters. */

import { RecipeSourceAdapterError } from '../../domain/recipe-source-adapter.contract';
import type { RecipeSourceExecutionContext } from '../../domain/recipe-source-adapter.contract';

export function mapSourceTransportError(
  error: unknown,
  context: RecipeSourceExecutionContext,
  operation: string,
  sourceCode: string,
  parserVersion: string,
): never {
  if (error instanceof RecipeSourceAdapterError) throw error;
  const message = error instanceof Error ? error.message : 'NETWORK_ERROR';
  const code =
    message.includes('RESPONSE_TOO_LARGE')
      ? 'RESPONSE_TOO_LARGE'
      : message.includes('UNSUPPORTED_CONTENT_TYPE')
        ? 'UNSUPPORTED_CONTENT_TYPE'
        : message.includes('REDIRECT')
          ? 'REDIRECT_FORBIDDEN'
          : message.includes('DOMAIN_NOT_ALLOWLISTED') ||
              message.includes('HOST_FORBIDDEN') ||
              message.includes('PRIVATE') ||
              message.includes('IP_LITERAL') ||
              message.includes('SCHEME') ||
              message.includes('CRLF') ||
              message.includes('TRAVERSAL') ||
              message.includes('PATH_FORBIDDEN')
            ? 'POLICY_BLOCKED'
            : message === 'NOT_FOUND'
              ? 'NOT_FOUND'
              : message === 'RATE_LIMITED'
                ? 'RATE_LIMITED'
                : message === 'PARSER_INCOMPATIBLE'
                  ? 'PARSER_INCOMPATIBLE'
                  : message === 'ACCESS_DENIED'
                    ? 'AUTH_REQUIRED'
                    : 'PARSE_ERROR';
  throw new RecipeSourceAdapterError({
    code,
    sourceCode,
    operation,
    retryable: code === 'RATE_LIMITED',
    safeMessage: message,
    correlationId: context.correlationId,
    parserVersion,
  });
}

export function scenarioFromExternalId(externalId: string): string {
  const id = String(externalId).trim().toLowerCase();
  if (id.startsWith('fixture:')) return id.slice('fixture:'.length);
  if (id.includes('parity')) return 'parity-dish';
  if (id.includes('removed')) return 'removed-recipe';
  if (id.includes('denied') || id.includes('access')) return 'access-denied';
  if (id.includes('rate')) return 'rate-limited';
  if (id.includes('incompatible')) return 'parser-incompatible';
  if (id.includes('dom')) return 'recipe-dom-fallback';
  if (id.includes('changed')) return 'changed-payload';
  if (id.includes('duplicate')) return 'duplicate-payload';
  if (id.includes('oversized')) return 'oversized-response';
  if (id.includes('foreign') || id.includes('redirect')) return 'foreign-redirect';
  if (id.includes('malicious')) return 'malicious-script';
  if (id.includes('missing-servings')) return 'missing-servings';
  if (id.includes('missing-nutrition')) return 'missing-nutrition';
  if (id.includes('missing-quant') || id.includes('missing-quantity')) return 'missing-quantities';
  if (id.includes('to-taste') || id.includes('taste')) return 'ingredient-to-taste';
  if (id.includes('fraction')) return 'fractional-quantity';
  if (id.includes('range')) return 'quantity-range';
  if (id.includes('unknown-unit')) return 'unknown-unit';
  if (id.includes('ambiguous')) return 'ambiguous-product';
  if (id.includes('unknown-product')) return 'unknown-product';
  return 'recipe-valid-structured';
}

export function urlSlugForScenario(scenario: string, fallback: string): string {
  const slug = scenario.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{1,120}$/.test(slug)) return slug;
  return fallback;
}
