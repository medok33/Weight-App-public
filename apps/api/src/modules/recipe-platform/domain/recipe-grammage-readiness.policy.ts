import { resolveIngredientGrams, type GrammageResolution, type GrammageResolutionState } from './recipe-grammage-authority.policy';
import { normalizeUnit } from './recipe-research.policy';

export type GrammageGapClass = 'DENSITY_AUTHORITY' | 'PIECE_WEIGHT_AUTHORITY' | 'MISSING_OR_MALFORMED_QUANTITY' | 'UNSUPPORTED_UNIT' | 'OTHER';
export type GrammageReadinessLine = {
  clusterId: string;
  canonicalDonorCandidateId: string;
  sourceCandidateId: string | undefined;
  sourceIngredientOrdinal: number | null | undefined;
  rawIngredientName: string;
  normalizedIngredientIdentity: string | null;
  rawAmount: number | null;
  rawUnit: string | null;
  resolution: GrammageResolution;
  blockerClass: GrammageGapClass | null;
  requiredAuthorityType: 'DENSITY_G_PER_ML' | 'MASS_PER_PIECE' | null;
};

export type GrammageReadiness = {
  state: 'GRAMMAGE_RESOLVED' | 'GRAMMAGE_UNRESOLVED';
  readiness: 'READY_FOR_SYNTHESIS' | 'NOT_READY_FOR_SYNTHESIS';
  resolvedRequiredLines: number;
  unresolvedRequiredLines: number;
  lines: GrammageReadinessLine[];
};

const resolvedStates = new Set<GrammageResolutionState>(['EXACT_METRIC', 'CONVERTED_WITH_AUTHORITY', 'PROCESS_INPUT_TRACKED']);
function normalizeSourceUnit(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const internal: Record<string, string> = { SHT: 'piece', STOL_L: 'tbsp', CHAYN_L: 'tsp' };
  const normalized = normalizeUnit(value).unit;
  return internal[value.trim().toUpperCase()] ?? normalized ?? value.trim();
}

function gapClass(line: { amount: unknown; unit: unknown }, resolution: GrammageResolution): GrammageGapClass | null {
  if (resolvedStates.has(resolution.state)) return null;
  if (resolution.state === 'BLOCKED_MISSING_AUTHORITY') {
    if (resolution.normalizedUnit === 'piece') return 'PIECE_WEIGHT_AUTHORITY';
    if (resolution.normalizedUnit === 'ml' || resolution.normalizedUnit === 'l' || resolution.normalizedUnit === 'tbsp') return 'DENSITY_AUTHORITY';
  }
  if (resolution.reason === 'UNIT_UNSUPPORTED') return 'UNSUPPORTED_UNIT';
  if (typeof line.amount !== 'number' || !Number.isFinite(line.amount) || line.amount <= 0 || typeof line.unit !== 'string' || !line.unit.trim()) return 'MISSING_OR_MALFORMED_QUANTITY';
  return 'OTHER';
}

/** Evaluates only canonical-donor selections; no representative or other donor data is consulted. */
export function evaluateBriefGrammageReadiness(input: { clusterId: string; canonicalDonorCandidateId: string; selections: Array<{ sourceLabel: unknown; productId: string | null; quantity: unknown; unit: unknown; role?: string; optional?: boolean; isOptional?: boolean; required?: boolean; sourceCandidateId?: string; sourceIngredientOrdinal?: number | null }> }): GrammageReadiness {
  const lines = input.selections.map((selection) => {
    const normalizedSourceUnit = normalizeSourceUnit(selection.unit);
    const sourceId = typeof selection.sourceCandidateId === 'string' ? selection.sourceCandidateId : undefined;
    const identityInvalid = sourceId !== input.canonicalDonorCandidateId || typeof selection.sourceIngredientOrdinal !== 'number' || !Number.isInteger(selection.sourceIngredientOrdinal) || selection.sourceIngredientOrdinal < 1;
    const resolution = identityInvalid ? resolveIngredientGrams({ amount: null, unit: null, rawQuantity: null, rawUnit: typeof selection.unit === 'string' ? selection.unit : null }) : resolveIngredientGrams({ amount: typeof selection.quantity === 'number' ? selection.quantity : null, unit: normalizedSourceUnit, rawQuantity: typeof selection.quantity === 'number' ? selection.quantity : null, rawUnit: typeof selection.unit === 'string' ? selection.unit : null, processInput: selection.role === 'PROCESS_INPUT' });
    const blocker = gapClass({ amount: selection.quantity, unit: selection.unit }, resolution);
    return {
      clusterId: input.clusterId,
      canonicalDonorCandidateId: input.canonicalDonorCandidateId,
      sourceCandidateId: selection.sourceCandidateId,
      sourceIngredientOrdinal: selection.sourceIngredientOrdinal,
      rawIngredientName: typeof selection.sourceLabel === 'string' ? selection.sourceLabel : '',
      normalizedIngredientIdentity: selection.productId,
      rawAmount: typeof selection.quantity === 'number' ? selection.quantity : null,
      rawUnit: typeof selection.unit === 'string' ? selection.unit : null,
      resolution,
      blockerClass: identityInvalid ? 'OTHER' : blocker,
      requiredAuthorityType: blocker === 'DENSITY_AUTHORITY' ? 'DENSITY_G_PER_ML' : blocker === 'PIECE_WEIGHT_AUTHORITY' ? 'MASS_PER_PIECE' : null,
    } satisfies GrammageReadinessLine;
  });
  const unresolvedRequiredLines = lines.filter((line) => line.blockerClass !== null).length;
  return { state: unresolvedRequiredLines === 0 ? 'GRAMMAGE_RESOLVED' : 'GRAMMAGE_UNRESOLVED', readiness: unresolvedRequiredLines === 0 ? 'READY_FOR_SYNTHESIS' : 'NOT_READY_FOR_SYNTHESIS', resolvedRequiredLines: lines.length - unresolvedRequiredLines, unresolvedRequiredLines, lines };
}

export type AuthorityGapLedgerRow = GrammageReadinessLine & { gapKey: string };

export function buildAuthorityGapLedger(readiness: GrammageReadiness[]): AuthorityGapLedgerRow[] {
  return readiness.flatMap((brief) => brief.lines.filter((line) => line.blockerClass !== null).map((line) => ({ ...line, gapKey: `${line.blockerClass}:${line.resolution.normalizedUnit ?? 'MISSING_UNIT'}:${line.normalizedIngredientIdentity ?? line.rawIngredientName}:${line.requiredAuthorityType ?? 'NONE'}` })));
}
