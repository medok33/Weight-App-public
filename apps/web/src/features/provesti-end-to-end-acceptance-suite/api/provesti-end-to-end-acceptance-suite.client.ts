import type { AcceptanceScenario } from '../model/provesti-end-to-end-acceptance-suite.types';
import { ACCEPTANCE_SCENARIOS } from '../model/provesti-end-to-end-acceptance-suite.types';

export async function getAcceptanceScenarios(): Promise<AcceptanceScenario[]> {
  // Catalog is local (PLATFORM acceptance checklist); health probe is optional smoke.
  try {
    const response = await fetch('/api/health/ready', { cache: 'no-store' });
    if (!response.ok) throw new Error('ACCEPTANCE_HEALTH_FAILED');
  } catch {
    throw new Error('ACCEPTANCE_HEALTH_FAILED');
  }
  return ACCEPTANCE_SCENARIOS;
}
