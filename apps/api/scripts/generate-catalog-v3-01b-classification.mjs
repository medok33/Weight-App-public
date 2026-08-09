/**
 * One-shot generator: audit CSV → TypeScript classification SoT for CATALOG-V3-01B.
 * Source: D:/WA/audit-artifacts/WORKOUT-CATALOG-V3-SCOPE-01/03_EXISTING_84_AUDIT_MATRIX.csv
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const CSV =
  process.env.CATALOG_V3_01B_AUDIT_CSV ??
  'D:/WA/audit-artifacts/WORKOUT-CATALOG-V3-SCOPE-01/03_EXISTING_84_AUDIT_MATRIX.csv';
const OUT = path.join(
  ROOT,
  'apps/api/src/modules/workout-engine/catalog/catalog-v3-01b-classification.ts',
);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      if (c === '"') {
        q = false;
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"') {
      q = true;
      continue;
    }
    if (c === ',') {
      row.push(cur);
      cur = '';
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && n === '\n') i += 1;
      row.push(cur);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function parseEquipment(proposed) {
  const raw = (proposed ?? '').trim();
  if (!raw) {
    throw new Error('EMPTY_EQUIPMENT');
  }
  // Audit uses CODE or CODE+CODE for ALL_OF. No ANY_OF rows in 01B matrix.
  const codes = raw.split('+').map((s) => s.trim()).filter(Boolean);
  if (codes.length === 0) throw new Error(`BAD_EQUIPMENT:${raw}`);
  return [
    {
      groupKind: 'ALL_OF',
      sortOrder: 0,
      items: codes.map((equipmentCode, sortOrder) => ({ equipmentCode, sortOrder })),
    },
  ];
}

function parseSecondaryMuscles(cell) {
  if (!cell || !cell.trim()) return [];
  return cell
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const text = fs.readFileSync(CSV, 'utf8');
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const required = [
    'exerciseKey',
    'revision',
    'proposedDisposition',
    'proposedPrimaryMuscle',
    'proposedSecondaryMuscles',
    'proposedMovementPattern',
    'proposedEquipment',
    'proposedTrainingRole',
    'proposedDifficulty',
    'progressionGroup',
    'reason',
  ];
  for (const col of required) {
    if (idx[col] == null) throw new Error(`MISSING_COL:${col}`);
  }

  const entries = [];
  for (const r of rows.slice(1)) {
    const exerciseKey = r[idx.exerciseKey];
    const auditBaseRevisionNumber = Number(r[idx.revision]);
    const disposition = r[idx.proposedDisposition];
    const primaryMuscle = r[idx.proposedPrimaryMuscle];
    const secondary = parseSecondaryMuscles(r[idx.proposedSecondaryMuscles]);
    const pattern = r[idx.proposedMovementPattern];
    const trainingRole = r[idx.proposedTrainingRole];
    const difficulty = r[idx.proposedDifficulty];
    const progressionGroup = r[idx.progressionGroup];
    const reason = r[idx.reason];
    const equipmentGroups = parseEquipment(r[idx.proposedEquipment]);

    const muscles = [
      { muscleCode: primaryMuscle, involvement: 'PRIMARY', sortOrder: 0 },
      ...secondary.map((muscleCode, i) => ({
        muscleCode,
        involvement: 'SECONDARY',
        sortOrder: i + 1,
      })),
    ];

    entries.push({
      exerciseKey,
      disposition,
      auditBaseRevisionNumber,
      primaryMovementPattern: pattern,
      trainingRole,
      difficulty,
      progressionGroup,
      muscles,
      equipmentGroups,
      reason,
      identityAction:
        disposition === 'MERGE_VARIANT' ? 'PLAN_ONLY_NO_PHYSICAL_MERGE' : 'KEEP_IDENTITY',
    });
  }

  entries.sort((a, b) => a.exerciseKey.localeCompare(b.exerciseKey));

  const body = entries
    .map((e) => {
      const muscles = e.muscles
        .map(
          (m) =>
            `      { muscleCode: '${m.muscleCode}', involvement: '${m.involvement}', sortOrder: ${m.sortOrder} }`,
        )
        .join(',\n');
      const groups = e.equipmentGroups
        .map((g) => {
          const items = g.items
            .map(
              (it) =>
                `          { equipmentCode: '${it.equipmentCode}', sortOrder: ${it.sortOrder} }`,
            )
            .join(',\n');
          return `      {
        groupKind: '${g.groupKind}',
        sortOrder: ${g.sortOrder},
        items: [
${items}
        ],
      }`;
        })
        .join(',\n');
      return `  {
    exerciseKey: '${e.exerciseKey}',
    disposition: '${e.disposition}',
    auditBaseRevisionNumber: ${e.auditBaseRevisionNumber},
    identityAction: '${e.identityAction}',
    primaryMovementPattern: '${e.primaryMovementPattern}',
    trainingRole: '${e.trainingRole}',
    difficulty: '${e.difficulty}',
    progressionGroup: '${e.progressionGroup}',
    muscles: [
${muscles}
    ],
    equipmentGroups: [
${groups}
    ],
    reason: ${JSON.stringify(e.reason)},
  }`;
    })
    .join(',\n');

  const out = `/**
 * CATALOG-V3-01B — deterministic V3 classification SoT for the current 84 exercises.
 * Generated from WORKOUT-CATALOG-V3-SCOPE-01/03_EXISTING_84_AUDIT_MATRIX.csv.
 * Do not invent UNKNOWN/OTHER/fake readiness. Regenerator:
 *   node apps/api/scripts/generate-catalog-v3-01b-classification.mjs
 */
import type { V3EquipmentGroupDraft, V3MuscleInvolvementDraft } from './catalog-v3-taxonomy';

export const CATALOG_V3_01B_CLASSIFICATION_VERSION =
  'workout-catalog-v3-01b-classification.1' as const;

export const CATALOG_V3_01B_CREATED_BY = 'system:catalog-v3-01b' as const;

/** Advisory lock for disposable-apply of 01B classification (distinct from publish/energy). */
export const CATALOG_V3_01B_ADVISORY_LOCK_KEY = 219_01_001;

export const V3_01B_DISPOSITIONS = [
  'KEEP',
  'KEEP_RENAME',
  'KEEP_RECLASSIFY',
  'MERGE_VARIANT',
  'KEEP_NOT_DEFAULT',
  'DEPRECATE',
] as const;
export type V301bDisposition = (typeof V3_01B_DISPOSITIONS)[number];

export const V3_01B_DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type V301bDifficulty = (typeof V3_01B_DIFFICULTIES)[number];

export type V301bIdentityAction =
  | 'KEEP_IDENTITY'
  | 'PLAN_ONLY_NO_PHYSICAL_MERGE';

export type V301bClassificationEntry = {
  exerciseKey: string;
  disposition: V301bDisposition;
  /** Audit matrix revision column (published pin revision at audit time). */
  auditBaseRevisionNumber: number;
  identityAction: V301bIdentityAction;
  primaryMovementPattern: string;
  trainingRole: string;
  difficulty: V301bDifficulty;
  progressionGroup: string;
  muscles: readonly V3MuscleInvolvementDraft[];
  equipmentGroups: readonly V3EquipmentGroupDraft[];
  reason: string;
};

export const CATALOG_V3_01B_CLASSIFICATION: readonly V301bClassificationEntry[] = [
${body}
];
`;

  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`Wrote ${entries.length} entries → ${OUT}`);
}

main();
