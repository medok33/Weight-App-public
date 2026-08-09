/**
 * WORKOUT-CATALOG-V3-01A — domain validation for taxonomy drafts.
 * Does not mutate DB; used by future writers and unit tests.
 */
import {
  isV3EquipmentCode,
  isV3EquipmentGroupKind,
  isV3MovementPatternCode,
  isV3MuscleCode,
  isV3TrainingRole,
  V3_MUSCLE_INVOLVEMENTS,
  type V3RevisionTaxonomyDraft,
  type V3TaxonomyIssue,
} from './catalog-v3-taxonomy';

export function validateV3RevisionTaxonomyDraft(
  draft: V3RevisionTaxonomyDraft,
): V3TaxonomyIssue[] {
  const issues: V3TaxonomyIssue[] = [];

  if (!draft.exerciseRevisionId || !draft.exerciseRevisionId.trim()) {
    issues.push({ code: 'MISSING_REVISION_ID', message: 'exerciseRevisionId is required' });
  }

  if (draft.primaryMovementPattern != null && draft.primaryMovementPattern !== '') {
    if (!isV3MovementPatternCode(draft.primaryMovementPattern)) {
      issues.push({
        code: 'INVALID_PRIMARY_PATTERN',
        message: `Invalid primaryMovementPattern ${draft.primaryMovementPattern}`,
        path: 'primaryMovementPattern',
      });
    }
  }
  if (draft.secondaryMovementPattern != null && draft.secondaryMovementPattern !== '') {
    if (!isV3MovementPatternCode(draft.secondaryMovementPattern)) {
      issues.push({
        code: 'INVALID_SECONDARY_PATTERN',
        message: `Invalid secondaryMovementPattern ${draft.secondaryMovementPattern}`,
        path: 'secondaryMovementPattern',
      });
    }
  }
  if (
    draft.primaryMovementPattern &&
    draft.secondaryMovementPattern &&
    draft.primaryMovementPattern === draft.secondaryMovementPattern
  ) {
    issues.push({
      code: 'PATTERN_DUPLICATE',
      message: 'primary and secondary movement patterns must differ',
    });
  }

  if (draft.trainingRole != null && draft.trainingRole !== '') {
    if (!isV3TrainingRole(draft.trainingRole)) {
      issues.push({
        code: 'INVALID_TRAINING_ROLE',
        message: `Invalid trainingRole ${draft.trainingRole}`,
        path: 'trainingRole',
      });
    }
  }

  if (draft.progressionGroup != null && draft.progressionGroup.trim() === '') {
    issues.push({
      code: 'EMPTY_PROGRESSION_GROUP',
      message: 'progressionGroup must be null or non-empty',
      path: 'progressionGroup',
    });
  }

  const muscleSeen = new Set<string>();
  let primaryCount = 0;
  for (const [i, m] of (draft.muscles ?? []).entries()) {
    if (!isV3MuscleCode(m.muscleCode)) {
      issues.push({
        code: 'INVALID_MUSCLE_CODE',
        message: `Invalid muscleCode ${m.muscleCode}`,
        path: `muscles[${i}]`,
      });
    }
    if (!(V3_MUSCLE_INVOLVEMENTS as readonly string[]).includes(m.involvement)) {
      issues.push({
        code: 'INVALID_MUSCLE_INVOLVEMENT',
        message: `Invalid involvement ${m.involvement}`,
        path: `muscles[${i}]`,
      });
    }
    if (muscleSeen.has(m.muscleCode)) {
      issues.push({
        code: 'DUPLICATE_MUSCLE',
        message: `Duplicate muscleCode ${m.muscleCode} on revision`,
        path: `muscles[${i}]`,
      });
    }
    muscleSeen.add(m.muscleCode);
    if (m.involvement === 'PRIMARY') primaryCount += 1;
  }
  if ((draft.muscles?.length ?? 0) > 0 && primaryCount < 1) {
    issues.push({
      code: 'MISSING_PRIMARY_MUSCLE',
      message: 'When muscles are provided, at least one PRIMARY is required',
    });
  }

  const groupOrders = new Set<number>();
  for (const [gi, g] of (draft.equipmentGroups ?? []).entries()) {
    if (!isV3EquipmentGroupKind(g.groupKind)) {
      issues.push({
        code: 'INVALID_EQUIPMENT_GROUP_KIND',
        message: `Invalid groupKind ${g.groupKind}`,
        path: `equipmentGroups[${gi}]`,
      });
    }
    const order = g.sortOrder ?? gi;
    if (groupOrders.has(order)) {
      issues.push({
        code: 'DUPLICATE_EQUIPMENT_GROUP_ORDER',
        message: `Duplicate equipment group sortOrder ${order}`,
        path: `equipmentGroups[${gi}]`,
      });
    }
    groupOrders.add(order);

    if (!g.items || g.items.length === 0) {
      issues.push({
        code: 'EMPTY_EQUIPMENT_GROUP',
        message: `${g.groupKind} group must contain at least one equipment item`,
        path: `equipmentGroups[${gi}]`,
      });
      continue;
    }
    const itemCodes = new Set<string>();
    for (const [ii, item] of g.items.entries()) {
      if (!isV3EquipmentCode(item.equipmentCode)) {
        issues.push({
          code: 'INVALID_EQUIPMENT_CODE',
          message: `Invalid equipmentCode ${item.equipmentCode}`,
          path: `equipmentGroups[${gi}].items[${ii}]`,
        });
      }
      if (itemCodes.has(item.equipmentCode)) {
        issues.push({
          code: 'DUPLICATE_EQUIPMENT_ITEM',
          message: `Duplicate equipmentCode ${item.equipmentCode} in group`,
          path: `equipmentGroups[${gi}].items[${ii}]`,
        });
      }
      itemCodes.add(item.equipmentCode);
    }
  }

  return issues;
}

export function assertV3RevisionTaxonomyDraftValid(draft: V3RevisionTaxonomyDraft): void {
  const issues = validateV3RevisionTaxonomyDraft(draft);
  if (issues.length) {
    throw new Error(
      `V3_TAXONOMY_INVALID: ${issues.map((i) => `${i.code}:${i.message}`).join('; ')}`,
    );
  }
}

/** Evaluates whether allowed equipment satisfies ALL_OF / ANY_OF / OPTIONAL groups. */
export function equipmentGroupsSatisfied(
  groups: readonly { groupKind: string; codes: readonly string[] }[],
  allowed: ReadonlySet<string>,
): boolean {
  for (const g of groups) {
    if (g.groupKind === 'OPTIONAL') continue;
    if (g.groupKind === 'ALL_OF') {
      if (!g.codes.every((c) => allowed.has(c))) return false;
      continue;
    }
    if (g.groupKind === 'ANY_OF') {
      if (!g.codes.some((c) => allowed.has(c))) return false;
      continue;
    }
    return false;
  }
  return true;
}
