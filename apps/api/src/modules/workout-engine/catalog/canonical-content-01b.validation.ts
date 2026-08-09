/**
 * WORKOUT-CATALOG-01B — validate canonical-content-01b.json (single SoT).
 */
import { createRequire } from "node:module";
import {
  CANONICAL_RELEASE_CODE,
  CATALOG_MANIFEST_VERSION,
  GENERATOR_MOVEMENT_PATTERN,
  VARIANT_RELATION_TYPES,
  type ManifestMovementPattern,
} from "./catalog-enums";
import { WORKOUT_CATALOG_MANIFEST } from "./catalog-manifest";

const requireJson = createRequire(__filename);

export type CanonicalContentDocument = {
  package: string;
  releaseCode: string;
  manifestVersion: string;
  algorithmVersion: string;
  actor: string;
  counts: {
    exercises: number;
    families: number;
    existingTreatedWithNewRevision: number;
    newlyCreated: number;
  };
  sources: Array<{ code: string; baseUrl: string | null; sourceType: string }>;
  families: Array<{ slug: string; nameRu: string; nameEn: string; movementPattern: string }>;
  exercises: Array<{
    ordinal: number;
    key: string;
    familySlug: string;
    isExistingApproved: boolean;
    revisionNumber: number;
    nameRu: string;
    descriptionRu: string;
    techniqueRu: string;
    commonMistakeRu: string;
    easierVariantRu: string;
    breathingRu: string;
    stopConditionsRu: string;
    riskLevel: string;
    difficulty: string;
    estimatedMinutes: number;
    generatorMovementPattern: string;
    manifestMovementPattern: string;
    equipmentCodes: string[];
    muscleGroups: string[];
    safety: {
      kneeLoad: string;
      shoulderLoad: string;
      spineLoad: string;
      impactLevel: string;
      balanceRequirement: string;
      floorRequired: boolean;
      overheadMovement: boolean;
      deepKneeFlexion: boolean;
      singleLeg: boolean;
      beginnerAllowed: boolean;
      requiresSpotter: boolean;
      internalSafetyNote: string;
    };
    source: {
      sourceCode: string;
      externalReference: string;
      factualNotes: string;
    };
    candidates: {
      preferredKey: string | null;
      alternatives: Array<{
        key: string;
        relationType: string;
        priority: number;
        levelDelta: number;
      }>;
      exception?: string;
    };
  }>;
  candidateExceptions: Array<{ slug: string; reason: string }>;
};

export type CanonicalValidationIssue = { code: string; message: string };

const ENGLISH_ENUM_LEAK =
  /\b(BEGINNER|INTERMEDIATE|ADVANCED|HOME|GYM|NONE|BODYWEIGHT|SQUAT|HINGE|PUSH|PULL|CORE|CARDIO|MOBILITY|EASIER|HARDER|APPROVED|DRAFT|PLANNED)\b/;

function loadCanonicalDocument(): CanonicalContentDocument {
  return requireJson("./canonical-content-01b.json") as CanonicalContentDocument;
}

export function validateCanonicalContent01b(
  doc: CanonicalContentDocument = loadCanonicalDocument(),
): CanonicalValidationIssue[] {
  const issues: CanonicalValidationIssue[] = [];

  if (doc.releaseCode !== CANONICAL_RELEASE_CODE) {
    issues.push({
      code: "RELEASE_CODE",
      message: `Expected ${CANONICAL_RELEASE_CODE}, got ${doc.releaseCode}`,
    });
  }
  if (doc.manifestVersion !== CATALOG_MANIFEST_VERSION) {
    issues.push({
      code: "MANIFEST_VERSION",
      message: `Expected ${CATALOG_MANIFEST_VERSION}, got ${doc.manifestVersion}`,
    });
  }
  if (doc.exercises.length !== 84) {
    issues.push({ code: "EXERCISE_COUNT", message: `Expected 84, got ${doc.exercises.length}` });
  }
  if (doc.families.length !== 36) {
    issues.push({ code: "FAMILY_COUNT", message: `Expected 36, got ${doc.families.length}` });
  }
  if (doc.counts.existingTreatedWithNewRevision !== 20) {
    issues.push({
      code: "EXISTING_COUNT",
      message: `Expected 20 existing, got ${doc.counts.existingTreatedWithNewRevision}`,
    });
  }
  if (doc.counts.newlyCreated !== 64) {
    issues.push({
      code: "NEW_COUNT",
      message: `Expected 64 new, got ${doc.counts.newlyCreated}`,
    });
  }

  const keys = new Set<string>();
  const ordinals = new Set<number>();
  const familySlugs = new Set(doc.families.map((f) => f.slug));
  const sourceCodes = new Set(doc.sources.map((s) => s.code));

  for (const family of doc.families) {
    if (!family.nameRu?.trim() || /[A-Z]{3,}_[A-Z]/.test(family.nameRu)) {
      issues.push({ code: "FAMILY_NAME", message: `Bad family nameRu for ${family.slug}` });
    }
  }

  for (const ex of doc.exercises) {
    if (keys.has(ex.key)) {
      issues.push({ code: "DUP_KEY", message: `Duplicate key ${ex.key}` });
    }
    keys.add(ex.key);
    if (ordinals.has(ex.ordinal)) {
      issues.push({ code: "DUP_ORDINAL", message: `Duplicate ordinal ${ex.ordinal}` });
    }
    ordinals.add(ex.ordinal);

    if (!familySlugs.has(ex.familySlug)) {
      issues.push({ code: "ORPHAN_FAMILY", message: `Missing family ${ex.familySlug} for ${ex.key}` });
    }

    const expectedGen =
      GENERATOR_MOVEMENT_PATTERN[ex.manifestMovementPattern as ManifestMovementPattern];
    if (expectedGen && ex.generatorMovementPattern !== expectedGen) {
      issues.push({
        code: "GENERATOR_PATTERN",
        message: `Pattern map mismatch on ${ex.key}`,
      });
    }

    const mandatory = [
      ex.nameRu,
      ex.descriptionRu,
      ex.techniqueRu,
      ex.commonMistakeRu,
      ex.easierVariantRu,
      ex.breathingRu,
      ex.stopConditionsRu,
      ex.safety?.internalSafetyNote,
      ex.source?.externalReference,
      ex.source?.factualNotes,
    ];
    if (mandatory.some((v) => !v || !String(v).trim())) {
      issues.push({ code: "MISSING_CONTENT", message: `Missing mandatory content on ${ex.key}` });
    }

    for (const field of [ex.nameRu, ex.descriptionRu, ex.techniqueRu, ex.commonMistakeRu, ex.easierVariantRu]) {
      if (ENGLISH_ENUM_LEAK.test(field)) {
        issues.push({
          code: "ENUM_LEAK",
          message: `English enum leak in user text for ${ex.key}`,
        });
        break;
      }
    }

    if (!sourceCodes.has(ex.source.sourceCode)) {
      issues.push({ code: "SOURCE_CODE", message: `Unknown source on ${ex.key}` });
    }
    if (/example\.com/i.test(ex.source.externalReference)) {
      issues.push({ code: "FAKE_SOURCE", message: `Stub source on ${ex.key}` });
    }

    if (ex.isExistingApproved && ex.revisionNumber !== 2) {
      issues.push({ code: "REV_NUM", message: `Existing ${ex.key} must use revision 2` });
    }
    if (!ex.isExistingApproved && ex.revisionNumber !== 1) {
      issues.push({ code: "REV_NUM", message: `New ${ex.key} must use revision 1` });
    }

    const seenEdges = new Set<string>();
    const seenPriorities = new Set<number>();
    for (const alt of ex.candidates.alternatives) {
      if (alt.key === ex.key) {
        issues.push({ code: "SELF_CANDIDATE", message: `Self candidate on ${ex.key}` });
      }
      if (!(VARIANT_RELATION_TYPES as readonly string[]).includes(alt.relationType)) {
        issues.push({
          code: "RELATION_TYPE",
          message: `Bad relationType ${alt.relationType} on ${ex.key}`,
        });
      }
      if (seenPriorities.has(alt.priority)) {
        issues.push({
          code: "DUP_PRIORITY",
          message: `Duplicate candidate priority ${alt.priority} on ${ex.key}`,
        });
      }
      seenPriorities.add(alt.priority);
      const edgeKey = `${alt.key}|${alt.relationType}`;
      if (seenEdges.has(edgeKey)) {
        issues.push({ code: "DUP_CANDIDATE", message: `Duplicate candidate edge on ${ex.key}` });
      }
      seenEdges.add(edgeKey);
    }

    if (ex.candidates.alternatives.length > 0) {
      const preferred = ex.candidates.alternatives.find((a) => a.priority === 0);
      if (!preferred || preferred.key !== ex.candidates.preferredKey) {
        issues.push({
          code: "PREFERRED_PRIORITY",
          message: `Preferred must be priority 0 on ${ex.key}`,
        });
      }
      if (preferred && (preferred.relationType === "HARDER" || preferred.levelDelta > 0)) {
        issues.push({
          code: "PREFERRED_HARDER",
          message: `Preferred must not be HARDER/advanced on ${ex.key}`,
        });
      }
      if (
        preferred &&
        preferred.relationType !== "EASIER" &&
        preferred.relationType !== "SAME_LEVEL"
      ) {
        issues.push({
          code: "PREFERRED_TYPE",
          message: `Preferred relationType must be EASIER|SAME_LEVEL on ${ex.key}`,
        });
      }
    }

    for (const text of [
      ex.techniqueRu,
      ex.commonMistakeRu,
      ex.easierVariantRu,
      ex.breathingRu,
      ex.stopConditionsRu,
      ex.descriptionRu,
    ]) {
      if (/\bTODO\b|placeholder|example\.com/i.test(text)) {
        issues.push({ code: "PLACEHOLDER", message: `Placeholder text on ${ex.key}` });
      }
      if (/через\s+боль|давлени[ея]\s+через\s+боль|работайте\s+через\s+боль/i.test(text)) {
        issues.push({ code: "UNSAFE_PAIN", message: `Unsafe pain wording on ${ex.key}` });
      }
      if (/\d+\s*(ккал|kcal|калор)/i.test(text)) {
        issues.push({ code: "CALORIE_CLAIM", message: `Exact calorie claim on ${ex.key}` });
      }
      if (/Начните\s+\S+ая\s+/i.test(text) || /Начните\s+утренняя/i.test(text)) {
        issues.push({ code: "BAD_GRAMMAR", message: `Bad grammar pattern on ${ex.key}` });
      }
    }

    const ref = ex.source.externalReference ?? "";
    if (!/^https?:\/\//i.test(ref) || /\s/.test(ref)) {
      issues.push({ code: "BAD_URL", message: `Malformed source URL on ${ex.key}` });
    }
    if (/exrx\.net\/Lists\/Directory\/?$/i.test(ref)) {
      issues.push({
        code: "GENERIC_EXRX_ROOT",
        message: `ExRx directory root is not sufficient sole source on ${ex.key}`,
      });
    }
  }

  // Duplicate / systemic template degradation guards.
  // Documented thresholds: exact-duplicate groups are allowed for related movements,
  // but a single text used across the whole catalog (or across many families) fails.
  const DUP_MAX_SHARE = 0.25; // >25% of catalog sharing one exact text → fail
  const DUP_MAX_FAMILIES = 8; // same exact text spanning >8 families → fail
  for (const field of [
    "techniqueRu",
    "commonMistakeRu",
    "easierVariantRu",
    "breathingRu",
    "stopConditionsRu",
  ] as const) {
    const groups = new Map<string, { count: number; families: Set<string> }>();
    for (const ex of doc.exercises) {
      const text = String(ex[field] ?? "").trim();
      if (!text) continue;
      const g = groups.get(text) ?? { count: 0, families: new Set<string>() };
      g.count += 1;
      g.families.add(ex.familySlug);
      groups.set(text, g);
    }
    for (const [text, g] of groups) {
      if (g.count === doc.exercises.length) {
        issues.push({
          code: "DUP_SYSTEMIC",
          message: `${field} identical across all ${g.count} exercises`,
        });
      } else if (g.count / doc.exercises.length > DUP_MAX_SHARE) {
        issues.push({
          code: "DUP_SYSTEMIC",
          message: `${field} exact text used ${g.count}/${doc.exercises.length} (>${DUP_MAX_SHARE * 100}%): ${text.slice(0, 48)}…`,
        });
      } else if (g.families.size > DUP_MAX_FAMILIES) {
        issues.push({
          code: "DUP_CROSS_FAMILY",
          message: `${field} exact text spans ${g.families.size} families (>${DUP_MAX_FAMILIES}): ${text.slice(0, 48)}…`,
        });
      }
    }
  }

  // Manifest inventory must stay aligned on keys/families.
  const manifestKeys = new Set(WORKOUT_CATALOG_MANIFEST.map((e) => e.slug));
  for (const key of keys) {
    if (!manifestKeys.has(key)) {
      issues.push({ code: "MANIFEST_DRIFT", message: `SoT key missing from TS manifest: ${key}` });
    }
  }
  for (const entry of WORKOUT_CATALOG_MANIFEST) {
    if (!keys.has(entry.slug)) {
      issues.push({
        code: "MANIFEST_DRIFT",
        message: `TS manifest key missing from SoT: ${entry.slug}`,
      });
    }
  }

  const usedFamilies = new Set(doc.exercises.map((e) => e.familySlug));
  for (const slug of familySlugs) {
    if (!usedFamilies.has(slug)) {
      issues.push({ code: "UNUSED_FAMILY", message: `Orphan family ${slug}` });
    }
  }

  return issues;
}

export function assertCanonicalContent01bValid(): void {
  const issues = validateCanonicalContent01b();
  if (issues.length) {
    throw new Error(
      `CANONICAL_CONTENT_01B_INVALID: ${issues.map((i) => `${i.code}:${i.message}`).join("; ")}`,
    );
  }
}

export function loadCanonicalContent01b(): CanonicalContentDocument {
  return loadCanonicalDocument();
}
