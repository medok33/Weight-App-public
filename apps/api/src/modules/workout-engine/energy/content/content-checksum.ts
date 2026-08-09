/**
 * Deterministic SHA-256 checksum for energy/timing content entries.
 * Excludes DB ids, createdAt/updatedAt, and the checksum field itself.
 * Invalid/null/undefined required fields throw — never silently hash.
 */
import { createHash } from 'node:crypto';
import type { EnergyContentEntry, TimingContentEntry } from './content.types';
import { isCanonicalReviewedAt } from './canonical-reviewed-at';

export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortKeys(record[key]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(stableJson(value));
}

const ENERGY_CHECKSUM_FIELDS = [
  'exerciseKey',
  'expectedPublishedRevisionNumber',
  'catalogReleaseKey',
  'policyVersion',
  'populationType',
  'contentVersion',
  'calculationMethod',
  'compendiumEdition',
  'compendiumCode',
  'metValue',
  'activityDescriptionEn',
  'sourceType',
  'sourceReference',
  'sourceVersion',
  'mappingClass',
  'rationale',
  'limitations',
  'reviewedBy',
  'reviewedAt',
  'status',
] as const;

const TIMING_CHECKSUM_FIELDS = [
  'exerciseKey',
  'expectedPublishedRevisionNumber',
  'catalogReleaseKey',
  'policyVersion',
  'populationType',
  'contentVersion',
  'timingMethod',
  'secondsPerRep',
  'evidenceClass',
  'sourceType',
  'sourceReference',
  'sourceVersion',
  'methodologyVersion',
  'oneRepDefinition',
  'unilateralSemantics',
  'phaseModel',
  'rationale',
  'romAssumptions',
  'techniqueAssumptions',
  'cadenceAssumptions',
  'limitations',
  'reviewedBy',
  'reviewedAt',
  'status',
] as const;

function assertRequiredChecksumField(field: string, value: unknown): void {
  if (value === null || value === undefined) {
    throw new Error(`CONTENT_CHECKSUM_INVALID_INPUT:${field}`);
  }
}

function pickFieldsForChecksum(
  entry: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = entry[field];
    assertRequiredChecksumField(field, value);
    out[field] = value;
  }
  return out;
}

/** Normalize numbers to fixed decimal string for stable hashing. */
export function canonicalizeNumber(value: number, places = 4): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('CONTENT_CHECKSUM_INVALID_NUMBER');
  }
  return value.toFixed(places);
}

export function canonicalizeEnergyForChecksum(
  entry: Omit<EnergyContentEntry, 'checksum'> | EnergyContentEntry | Record<string, unknown>,
): Record<string, unknown> {
  const record = entry as Record<string, unknown>;
  const picked = pickFieldsForChecksum(record, ENERGY_CHECKSUM_FIELDS);
  if (!isCanonicalReviewedAt(picked.reviewedAt)) {
    throw new Error('CONTENT_CHECKSUM_INVALID_INPUT:reviewedAt');
  }
  picked.metValue = canonicalizeNumber(Number(record.metValue), 3);
  if (typeof record.expectedPublishedRevisionNumber !== 'number') {
    throw new Error('CONTENT_CHECKSUM_INVALID_INPUT:expectedPublishedRevisionNumber');
  }
  picked.expectedPublishedRevisionNumber = record.expectedPublishedRevisionNumber;
  return picked;
}

export function canonicalizeTimingForChecksum(
  entry: Omit<TimingContentEntry, 'checksum'> | TimingContentEntry | Record<string, unknown>,
): Record<string, unknown> {
  const record = entry as Record<string, unknown>;
  const picked = pickFieldsForChecksum(record, TIMING_CHECKSUM_FIELDS);
  if (!isCanonicalReviewedAt(picked.reviewedAt)) {
    throw new Error('CONTENT_CHECKSUM_INVALID_INPUT:reviewedAt');
  }
  picked.secondsPerRep = canonicalizeNumber(Number(record.secondsPerRep), 4);
  if (typeof record.expectedPublishedRevisionNumber !== 'number') {
    throw new Error('CONTENT_CHECKSUM_INVALID_INPUT:expectedPublishedRevisionNumber');
  }
  picked.expectedPublishedRevisionNumber = record.expectedPublishedRevisionNumber;
  return picked;
}

export function computeEnergyContentChecksum(
  entry: Omit<EnergyContentEntry, 'checksum'> | EnergyContentEntry | Record<string, unknown>,
): string {
  return hashCanonical(canonicalizeEnergyForChecksum(entry));
}

export function computeTimingContentChecksum(
  entry: Omit<TimingContentEntry, 'checksum'> | TimingContentEntry | Record<string, unknown>,
): string {
  return hashCanonical(canonicalizeTimingForChecksum(entry));
}

export function withEnergyChecksum(
  entry: Omit<EnergyContentEntry, 'checksum'>,
): EnergyContentEntry {
  return { ...entry, checksum: computeEnergyContentChecksum(entry) };
}

export function withTimingChecksum(
  entry: Omit<TimingContentEntry, 'checksum'>,
): TimingContentEntry {
  return { ...entry, checksum: computeTimingContentChecksum(entry) };
}
