import { createHash } from 'node:crypto';

/** Maps public deterministic brief labels to the UUID used by persistence. */
export function briefIdToStorageUuid(value: string): string {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
