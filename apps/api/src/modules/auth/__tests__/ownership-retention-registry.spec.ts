import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTH_01B_MIGRATION_MANIFEST,
} from '../domain/auth-01b-migration-manifest';
import {
  OWNERSHIP_RETENTION_REGISTRY,
  assertRegistryCoversModels,
  ownershipRegistryEntries,
} from '../domain/ownership-retention-registry';

function schemaModels(): string[] {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  return [...schema.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s+\{/gm)].map((match) => match[1]!);
}

describe('AUTH-01B ownership retention registry', () => {
  it('covers every durable Prisma model and has zero unresolved owner decisions', () => {
    const models = schemaModels();
    expect(models).toHaveLength(137);
    expect(() => assertRegistryCoversModels(models)).not.toThrow();
    expect(ownershipRegistryEntries().filter(([, entry]) => entry.retention === undefined)).toEqual([]);
  });

  it('classifies previously blocked owner decisions explicitly', () => {
    expect(OWNERSHIP_RETENTION_REGISTRY.Payment.retention).toBe('USER_PERSONAL_ANONYMIZE');
    expect(OWNERSHIP_RETENTION_REGISTRY.Refund.retention).toBe('USER_PERSONAL_ANONYMIZE');
    expect(OWNERSHIP_RETENTION_REGISTRY.Entitlement.retention).toBe('USER_PERSONAL_ANONYMIZE');
    expect(OWNERSHIP_RETENTION_REGISTRY.Family.retention).toBe('GLOBAL_NON_USER_DATA');
    expect(OWNERSHIP_RETENTION_REGISTRY.FamilyMember.retention).toBe('USER_PERSONAL_PURGE');
    expect(OWNERSHIP_RETENTION_REGISTRY.SharedDishPortion.retention).toBe('USER_PERSONAL_PURGE');
    expect(OWNERSHIP_RETENTION_REGISTRY.BetaInvite.retention).toBe('SECURITY_AUDIT_MINIMAL');
    expect(OWNERSHIP_RETENTION_REGISTRY.AIControl.retention).toBe('GLOBAL_NON_USER_DATA');
    expect(OWNERSHIP_RETENTION_REGISTRY.FeatureFlag.retention).toBe('GLOBAL_NON_USER_DATA');
  });

  it('audits every AUTH-01B FK/nullability migration with preservation and ownership proof', () => {
    const setNullEntries = AUTH_01B_MIGRATION_MANIFEST.filter((entry) => entry.newOnDelete === 'SET NULL');
    expect(setNullEntries.map((entry) => `${entry.table}.${entry.column}`).sort()).toEqual([
      'AIControl.updatedBy',
      'BetaInvite.createdByUserId',
      'Entitlement.userId',
      'FamilyInvitation.invitedByUserId',
      'FamilyShoppingList.regeneratedByUserId',
      'FeatureFlag.updatedBy',
      'OwnerAuditEvent.userId',
      'Payment.userId',
      'SharedDish.createdByUserId',
    ]);
    for (const entry of setNullEntries) {
      expect(entry.preserveRowAfterUserDeletion).toBe('YES');
      expect(entry.fkIsNotPersonalRowOwnership).toBe('YES');
      expect(entry.reason).toMatch(/\S/);
    }
  });
});
