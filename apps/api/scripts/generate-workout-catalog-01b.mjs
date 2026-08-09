/**
 * WORKOUT-CATALOG-01B — generate canonical content SoT + migration 211 SQL.
 *
 * Source of truth output:
 *   apps/api/src/modules/workout-engine/catalog/canonical-content-01b.json
 * Migration output:
 *   apps/api/prisma/migrations/211_workout_catalog_canonical_content/migration.sql
 *
 * Run: node apps/api/scripts/generate-workout-catalog-01b.mjs
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_BODIES_01B,
  SOURCE_BY_KEY,
  PREFERRED_CANDIDATE_OVERRIDES,
  assertBodiesComplete,
} from "./lib/canonical-content-bodies-01b.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, "..");
const dumpPath = resolve(apiRoot, "src/modules/workout-engine/catalog/_manifest-dump.json");
const sotPath = resolve(apiRoot, "src/modules/workout-engine/catalog/canonical-content-01b.json");
const migDir = resolve(apiRoot, "prisma/migrations/211_workout_catalog_canonical_content");
const migPath = resolve(migDir, "migration.sql");

async function ensureManifestDump() {
  if (existsSync(dumpPath)) return;

  const { spawnSync } = await import("node:child_process");
  const tsxCli = createRequire(resolve(apiRoot, "package.json")).resolve("tsx/cli");
  const result = spawnSync(
    process.execPath,
    [
      tsxCli,
      "-e",
      "import { WORKOUT_CATALOG_MANIFEST, WORKOUT_CATALOG_MANIFEST_VERSION } from './src/modules/workout-engine/catalog/catalog-manifest.ts'; import { writeFileSync } from 'node:fs'; writeFileSync('src/modules/workout-engine/catalog/_manifest-dump.json', JSON.stringify({ version: WORKOUT_CATALOG_MANIFEST_VERSION, entries: WORKOUT_CATALOG_MANIFEST }));",
    ],
    { cwd: apiRoot, encoding: "utf8", shell: false },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to dump manifest: ${result.stderr || result.stdout}`);
  }
}

const GENERATOR_MOVEMENT_PATTERN = {
  squat: "squat",
  hinge: "hinge",
  lunge: "squat",
  horizontal_push: "push",
  vertical_push: "push",
  horizontal_pull: "pull",
  vertical_pull: "pull",
  carry: "cardio",
  anti_extension_core: "core",
  anti_rotation_core: "core",
  lateral_core: "core",
  glute_isolation: "hinge",
  calf: "mobility",
  mobility: "mobility",
  low_impact_conditioning: "cardio",
  recovery: "mobility",
};

const FAMILY_NAMES = {
  outdoor_walk: { nameRu: "Ходьба", nameEn: "Outdoor walk" },
  bodyweight_squat: { nameRu: "Приседания с весом тела", nameEn: "Bodyweight squat" },
  gentle_stretch: { nameRu: "Мягкая растяжка", nameEn: "Gentle stretch" },
  easy_jog: { nameRu: "Лёгкий бег", nameEn: "Easy jog" },
  plank: { nameRu: "Планка", nameEn: "Plank" },
  mobility_flow: { nameRu: "Подвижность", nameEn: "Mobility flow" },
  push_up: { nameRu: "Отжимания", nameEn: "Push-up" },
  glute_bridge: { nameRu: "Ягодичный мост", nameEn: "Glute bridge" },
  dead_bug: { nameRu: "Жук", nameEn: "Dead bug" },
  band_row: { nameRu: "Тяга эспандера", nameEn: "Band row" },
  band_pull_apart: { nameRu: "Разведение эспандера", nameEn: "Band pull-apart" },
  dumbbell_row: { nameRu: "Тяга гантели", nameEn: "Dumbbell row" },
  goblet_squat: { nameRu: "Гоблет-присед", nameEn: "Goblet squat" },
  leg_press: { nameRu: "Жим ногами", nameEn: "Leg press" },
  cable_row: { nameRu: "Тяга блока", nameEn: "Cable row" },
  treadmill_walk: { nameRu: "Ходьба на дорожке", nameEn: "Treadmill walk" },
  chest_press_machine: { nameRu: "Жим от груди", nameEn: "Chest press machine" },
  romanian_deadlift: { nameRu: "Румынская тяга", nameEn: "Romanian deadlift" },
  lat_pulldown: { nameRu: "Тяга верхнего блока", nameEn: "Lat pulldown" },
  hip_thrust: { nameRu: "Ягодичный толчок", nameEn: "Hip thrust" },
  lunge_split: { nameRu: "Выпады", nameEn: "Lunge / split squat" },
  step_up: { nameRu: "Шаг на возвышение", nameEn: "Step-up" },
  dumbbell_press: { nameRu: "Жим гантелей", nameEn: "Dumbbell press" },
  bench_press: { nameRu: "Жим лёжа", nameEn: "Bench press" },
  shoulder_press: { nameRu: "Жим над головой", nameEn: "Shoulder press" },
  barbell_row: { nameRu: "Тяга штанги в наклоне", nameEn: "Barbell row" },
  bird_dog: { nameRu: "Птица-собака", nameEn: "Bird dog" },
  side_plank: { nameRu: "Боковая планка", nameEn: "Side plank" },
  anti_rotation: { nameRu: "Анти-ротация", nameEn: "Anti-rotation" },
  hip_abduction: { nameRu: "Отведение бедра", nameEn: "Hip abduction" },
  calf_raise: { nameRu: "Подъём на носки", nameEn: "Calf raise" },
  farmer_carry: { nameRu: "Прогулка фермера", nameEn: "Farmer carry" },
  low_impact_cardio: { nameRu: "Кардио низкой ударности", nameEn: "Low-impact cardio" },
  recovery: { nameRu: "Восстановление", nameEn: "Recovery" },
  leg_curl: { nameRu: "Сгибание ног", nameEn: "Leg curl" },
  band_press: { nameRu: "Жим эспандера", nameEn: "Band press" },
};

const LEVEL_RANK = { BEGINNER: 1, INTERMEDIATE: 2, ADVANCED: 3 };

const WORKOUT_EQUIPMENT_CODES = new Set([
  "NONE",
  "BODYWEIGHT",
  "RESISTANCE_BAND",
  "DUMBBELL",
  "KETTLEBELL",
  "BENCH",
  "PULLUP_BAR",
  "GYM_MACHINES",
  "BARBELL",
  "CARDIO_MACHINE",
]);

function sqlStr(value) {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return sqlStr(JSON.stringify(value));
}

function deterministicUuid(seed) {
  const h = createHash("sha256").update(`workout-catalog-01b:${seed}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function mapEquipmentForGenerator(required) {
  const mapped = required.map((code) => {
    if (code === "MAT" || code === "CHAIR") return "BODYWEIGHT";
    if (code === "CABLE") return "GYM_MACHINES";
    return code;
  });
  const filtered = [...new Set(mapped.filter((c) => WORKOUT_EQUIPMENT_CODES.has(c)))];
  return filtered.length ? filtered : ["NONE"];
}

function riskFromImpact(impact) {
  if (impact === "HIGH") return "high";
  if (impact === "MODERATE") return "medium";
  return "low";
}

function estimatedMinutes(entry) {
  if (entry.repetitionMode === "DURATION") {
    if (
      entry.movementPattern === "low_impact_conditioning" ||
      entry.movementPattern === "recovery"
    ) {
      return 10;
    }
    return 5;
  }
  if (entry.minLevel === "ADVANCED") return 6;
  if (entry.minLevel === "INTERMEDIATE") return 5;
  return 4;
}

function kneeLoad(entry) {
  if (
    entry.deepKneeFlexion ||
    entry.movementPattern === "lunge" ||
    entry.movementPattern === "squat"
  ) {
    return entry.minLevel === "BEGINNER" ? "MODERATE" : "MODERATE";
  }
  if (entry.singleLeg) return "MODERATE";
  return "LOW";
}

function shoulderLoad(entry) {
  if (
    entry.overheadMovement ||
    entry.movementPattern === "horizontal_push" ||
    entry.movementPattern === "vertical_push" ||
    entry.movementPattern === "vertical_pull"
  ) {
    return "MODERATE";
  }
  if (entry.movementPattern === "horizontal_pull" || entry.movementPattern === "carry") {
    return "MODERATE";
  }
  return "LOW";
}

function spineLoad(entry) {
  if (
    entry.movementPattern === "hinge" ||
    entry.movementPattern === "anti_extension_core" ||
    entry.movementPattern === "carry" ||
    entry.slug.includes("row") ||
    entry.slug.includes("deadlift")
  ) {
    return "MODERATE";
  }
  return "LOW";
}

function descriptionFor(entry) {
  const place =
    entry.supportedPlaces.length === 2
      ? "дома и в зале"
      : entry.supportedPlaces.includes("HOME")
        ? "дома"
        : "в зале";
  const level =
    entry.minLevel === "BEGINNER"
      ? "подходит новичкам"
      : entry.minLevel === "INTERMEDIATE"
        ? "для уверенного базового уровня"
        : "для подготовленных";
  return `«${entry.nameRu}» — упражнение ${place}; ${level}. Короткий контролируемый подход без гонки за результатом.`;
}

function safetyNote(entry) {
  const bits = ["Канонический safety profile WORKOUT-CATALOG-01B"];
  if (entry.overheadMovement) bits.push("overhead");
  if (entry.deepKneeFlexion) bits.push("deep-knee");
  if (entry.singleLeg) bits.push("single-leg");
  if (entry.floorRequired) bits.push("floor");
  return bits.join("; ");
}

function sourceFor(key) {
  const source = SOURCE_BY_KEY[key];
  if (!source) throw new Error(`Missing canonical provenance for ${key}`);
  return source;
}

function compareEntries(a, b) {
  if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function relationFor(entry, candidate) {
  const levelDelta = LEVEL_RANK[candidate.minLevel] - LEVEL_RANK[entry.minLevel];
  if (levelDelta < 0) return { relationType: "EASIER", levelDelta };
  if (levelDelta > 0) return { relationType: "HARDER", levelDelta };
  if (entry.supportedPlaces.includes("HOME") && !candidate.supportedPlaces.includes("HOME")) {
    return { relationType: "GYM_ALTERNATIVE", levelDelta };
  }
  if (!entry.supportedPlaces.includes("HOME") && candidate.supportedPlaces.includes("HOME")) {
    return { relationType: "HOME_ALTERNATIVE", levelDelta };
  }
  return { relationType: "SAME_LEVEL", levelDelta };
}

function isEquipmentHeavyGymOnly(candidate) {
  const exclusive = new Set(["BARBELL", "GYM_MACHINES", "CABLE"]);
  return (
    candidate.supportedPlaces.length === 1 &&
    candidate.supportedPlaces[0] === "GYM" &&
    candidate.requiredEquipment.some((equipment) => exclusive.has(equipment))
  );
}

function buildCandidates(entries) {
  const byFamily = new Map();
  const byGenPattern = new Map();
  for (const e of entries) {
    if (!byFamily.has(e.familySlug)) byFamily.set(e.familySlug, []);
    byFamily.get(e.familySlug).push(e);
    const gp = GENERATOR_MOVEMENT_PATTERN[e.movementPattern];
    if (!byGenPattern.has(gp)) byGenPattern.set(gp, []);
    byGenPattern.get(gp).push(e);
  }
  for (const list of byFamily.values()) {
    list.sort(compareEntries);
  }
  for (const list of byGenPattern.values()) {
    list.sort(compareEntries);
  }

  /** @type {Record<string, { preferredKey: string | null, alternatives: Array<{ key: string, relationType: string, priority: number, levelDelta: number }>, exception?: string }>} */
  const graph = {};
  const exceptions = [];

  for (const entry of entries) {
    const family = byFamily.get(entry.familySlug) ?? [];
    const othersInFamily = family.filter((x) => x.slug !== entry.slug);
    const gp = GENERATOR_MOVEMENT_PATTERN[entry.movementPattern];
    const patternPeers = (byGenPattern.get(gp) ?? []).filter(
      (x) => x.slug !== entry.slug && x.familySlug !== entry.familySlug,
    );

    const pool = [...othersInFamily, ...patternPeers]
      .filter(
        (candidate, index, candidates) =>
          candidates.findIndex((item) => item.slug === candidate.slug) === index,
      )
      .sort(compareEntries);
    const override = PREFERRED_CANDIDATE_OVERRIDES[entry.slug];
    const overrideCandidate = pool.find((candidate) => candidate.slug === override);
    const preferredPool = pool
      .filter((candidate) => LEVEL_RANK[candidate.minLevel] <= LEVEL_RANK[entry.minLevel])
      .filter(
        (candidate) =>
          !(
            entry.supportedPlaces.includes("HOME") &&
            isEquipmentHeavyGymOnly(candidate) &&
            !candidate.supportedPlaces.includes("HOME")
          ),
      );
    const preferred =
      overrideCandidate ??
      preferredPool.sort(
        (a, b) => LEVEL_RANK[a.minLevel] - LEVEL_RANK[b.minLevel] || compareEntries(a, b),
      )[0] ??
      null;
    const alternatives = [];
    if (preferred) {
      const levelDelta = LEVEL_RANK[preferred.minLevel] - LEVEL_RANK[entry.minLevel];
      const relation = { relationType: levelDelta < 0 ? "EASIER" : "SAME_LEVEL", levelDelta };
      alternatives.push({ key: preferred.slug, priority: 0, ...relation });
    }
    for (const candidate of pool) {
      if (alternatives.length >= 5 || candidate.slug === preferred?.slug) continue;
      alternatives.push({
        key: candidate.slug,
        priority: alternatives.length,
        ...relationFor(entry, candidate),
      });
    }
    const alts = alternatives.sort(
      (a, b) => a.priority - b.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
    const preferredKey = preferred?.slug ?? null;

    let exception;
    if (alts.length === 0) {
      exception = `family ${entry.familySlug} singleton without compatible peer`;
      exceptions.push({ slug: entry.slug, reason: exception });
    } else if (alts.length < 3 && family.length < 3) {
      exception = `family size ${family.length}; only ${alts.length} compatible candidates`;
      exceptions.push({ slug: entry.slug, reason: exception });
    }

    graph[entry.slug] = {
      preferredKey,
      alternatives: alts,
      ...(exception ? { exception } : {}),
    };
  }

  return { graph, exceptions };
}

function buildCanonical(entries) {
  const { graph, exceptions } = buildCandidates(entries);
  const exercises = [...entries].sort(compareEntries).map((entry) => {
    const existing = entry.initialCatalogStatus === "EXISTING_APPROVED";
    const generatorPattern = GENERATOR_MOVEMENT_PATTERN[entry.movementPattern];
    const equipmentCodes = mapEquipmentForGenerator(entry.requiredEquipment);
    const minutes = estimatedMinutes(entry);
    const bodies = CANONICAL_BODIES_01B[entry.slug];
    if (!bodies) throw new Error(`Missing canonical bodies for ${entry.slug}`);
    const src = sourceFor(entry.slug);
    return {
      ordinal: entry.ordinal,
      key: entry.slug,
      familySlug: entry.familySlug,
      legacyExerciseKey: entry.legacyExerciseKey,
      isExistingApproved: existing,
      revisionNumber: existing ? 2 : 1,
      nameRu: entry.nameRu,
      nameEn: entry.nameEn,
      displayNameRu: entry.nameRu,
      displayNameEn: entry.nameEn,
      descriptionRu: descriptionFor(entry),
      techniqueRu: bodies.techniqueRu,
      techniqueEn: null,
      commonMistakeRu: bodies.commonMistakeRu,
      commonMistakeEn: null,
      easierVariantRu: bodies.easierVariantRu,
      easierVariantEn: null,
      harderVariantRu: null,
      harderVariantEn: null,
      breathingRu: bodies.breathingRu,
      breathingEn: null,
      stopConditionsRu: bodies.stopConditionsRu,
      stopConditionsEn: null,
      minLevel: entry.minLevel,
      difficulty: entry.minLevel,
      supportedPlaces: entry.supportedPlaces,
      requiredEquipment: entry.requiredEquipment,
      optionalEquipment: entry.optionalEquipment,
      equipmentCodes,
      manifestMovementPattern: entry.movementPattern,
      generatorMovementPattern: generatorPattern,
      primaryMuscleGroups: entry.primaryMuscleGroups,
      secondaryMuscleGroups: entry.secondaryMuscleGroups,
      muscleGroups: [...entry.primaryMuscleGroups, ...entry.secondaryMuscleGroups],
      repetitionMode: entry.repetitionMode,
      impactLevel: entry.impactLevel,
      balanceRequirement: entry.balanceRequirement,
      floorRequired: entry.floorRequired,
      overheadMovement: entry.overheadMovement,
      deepKneeFlexion: entry.deepKneeFlexion,
      singleLeg: entry.singleLeg,
      beginnerAllowed: entry.beginnerAllowed,
      riskLevel: riskFromImpact(entry.impactLevel),
      estimatedMinutes: minutes,
      defaultSets: entry.repetitionMode === "DURATION" ? 1 : 2,
      defaultRepsMin: entry.repetitionMode === "DURATION" ? null : 10,
      defaultRepsMax: entry.repetitionMode === "DURATION" ? null : 12,
      defaultDurationSeconds: entry.repetitionMode === "DURATION" ? minutes * 60 : null,
      defaultRestSeconds: 60,
      estimatedDurationSeconds: minutes * 60,
      safety: {
        kneeLoad: kneeLoad(entry),
        shoulderLoad: shoulderLoad(entry),
        spineLoad: spineLoad(entry),
        impactLevel: entry.impactLevel,
        balanceRequirement: entry.balanceRequirement,
        floorRequired: entry.floorRequired,
        overheadMovement: entry.overheadMovement,
        deepKneeFlexion: entry.deepKneeFlexion,
        singleLeg: entry.singleLeg,
        beginnerAllowed: entry.beginnerAllowed,
        requiresSpotter: false,
        internalSafetyNote: safetyNote(entry),
      },
      source: src,
      candidates: graph[entry.slug],
    };
  });

  const families = [...new Set(entries.map((e) => e.familySlug))].sort().map((slug) => {
    const sample = entries.find((e) => e.familySlug === slug);
    const names = FAMILY_NAMES[slug] ?? {
      nameRu: sample?.nameRu ?? slug,
      nameEn: sample?.nameEn ?? slug,
    };
    return {
      slug,
      nameRu: names.nameRu,
      nameEn: names.nameEn,
      movementPattern: sample.movementPattern,
    };
  });

  return {
    package: "WORKOUT-CATALOG-01B",
    releaseCode: "workout-catalog-canonical-01b",
    manifestVersion: "workout-catalog-manifest-01b.1",
    algorithmVersion: "workout-catalog-01b.1",
    actor: "system:workout-catalog-01b",
    counts: {
      exercises: exercises.length,
      families: families.length,
      existingTreatedWithNewRevision: exercises.filter((e) => e.isExistingApproved).length,
      newlyCreated: exercises.filter((e) => !e.isExistingApproved).length,
    },
    sources: [
      {
        id: deterministicUuid("source:who-physical-activity"),
        code: "who-physical-activity",
        displayName: "WHO Physical Activity Fact Sheet",
        sourceType: "PUBLIC_GUIDELINE",
        baseUrl: "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
      },
      {
        id: deterministicUuid("source:acsm-guidelines"),
        code: "acsm-guidelines",
        displayName: "ACSM Guidelines for Exercise Testing and Prescription",
        sourceType: "TEXTBOOK",
        baseUrl: "https://www.acsm.org/education-resources/books/guidelines-exercise-testing",
      },
      {
        id: deterministicUuid("source:exrx-exercise-reference"),
        code: "exrx-exercise-reference",
        displayName: "ExRx.net Exercise Directory",
        sourceType: "OTHER",
        baseUrl: "https://exrx.net/Lists/Directory",
      },
    ],
    families,
    exercises,
    candidateExceptions: exceptions,
  };
}

function emitMigration(sot) {
  const lines = [];
  const L = (s = "") => lines.push(s);

  L("-- 211: WORKOUT-CATALOG-01B canonical content (84 exercises / 36 families).");
  L(
    "-- Generated by apps/api/scripts/generate-workout-catalog-01b.mjs — do not hand-edit bulk data.",
  );
  L("-- Custom SQL migration: additive, non-destructive and safe to re-run.");
  L(
    "-- Does not mutate frozen APPROVED revisions from 01A (creates new DRAFT→APPROVED revisions).",
  );
  L("");
  L("-- ---------------------------------------------------------------------------");
  L("-- 01B FIX 2. Session content fields; release guard remains RETIRED-terminal");
  L("-- ---------------------------------------------------------------------------");
  L('ALTER TABLE "WorkoutSessionExercise"');
  L('  ADD COLUMN IF NOT EXISTS "breathingRu" text,');
  L('  ADD COLUMN IF NOT EXISTS "breathingEn" text,');
  L('  ADD COLUMN IF NOT EXISTS "stopConditionsRu" text,');
  L('  ADD COLUMN IF NOT EXISTS "stopConditionsEn" text;');
  L("");
  L("-- Hub display fields are written below for identity convenience; revisions remain read SoT.");
  L("-- RETIRED releases stay terminal: no production RETIRED→PUBLISHED recovery path.");
  L("CREATE OR REPLACE FUNCTION workout_catalog_release_immutable_guard()");
  L("RETURNS trigger");
  L("LANGUAGE plpgsql");
  L("AS $$");
  L("BEGIN");
  L(`  IF TG_OP = 'DELETE' THEN`);
  L(`    IF OLD.status IN ('PUBLISHED', 'RETIRED') THEN`);
  L(`      RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_IMMUTABLE';`);
  L("    END IF;");
  L("    RETURN OLD;");
  L("  END IF;");
  L("");
  L(`  IF OLD.status = 'PUBLISHED' THEN`);
  L(`    IF NEW.status = 'RETIRED'`);
  L(`       AND NEW.code IS NOT DISTINCT FROM OLD.code`);
  L(`       AND NEW."manifestVersion" IS NOT DISTINCT FROM OLD."manifestVersion"`);
  L(`       AND NEW."publishedAt" IS NOT DISTINCT FROM OLD."publishedAt"`);
  L(`       AND NEW."createdBy" IS NOT DISTINCT FROM OLD."createdBy"`);
  L(`       AND NEW.notes IS NOT DISTINCT FROM OLD.notes`);
  L("    THEN");
  L(`      NEW."retiredAt" := COALESCE(NEW."retiredAt", now());`);
  L("      RETURN NEW;");
  L("    END IF;");
  L(`    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_IMMUTABLE';`);
  L("  END IF;");
  L("");
  L(`  IF OLD.status = 'RETIRED' THEN`);
  L(`    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_IMMUTABLE';`);
  L("  END IF;");
  L("");
  L(`  IF OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED' THEN`);
  L("    PERFORM workout_catalog_release_publish_items_valid(NEW.id);");
  L(`    NEW."publishedAt" := COALESCE(NEW."publishedAt", OLD."publishedAt", now());`);
  L('    NEW."retiredAt" := NULL;');
  L("    RETURN NEW;");
  L("  END IF;");
  L("");
  L(`  IF OLD.status = 'DRAFT' AND NEW.status = 'RETIRED' THEN`);
  L(`    NEW."retiredAt" := COALESCE(NEW."retiredAt", now());`);
  L("    RETURN NEW;");
  L("  END IF;");
  L("");
  L(
    `  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('DRAFT', 'PUBLISHED', 'RETIRED') THEN`,
  );
  L(`    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_STATUS_INVALID';`);
  L("  END IF;");
  L("");
  L("  RETURN NEW;");
  L("END;");
  L("$$;");
  L("");
  L(`-- release: ${sot.releaseCode}`);
  L(`-- manifest: ${sot.manifestVersion}`);
  L("");

  L("-- ---------------------------------------------------------------------------");
  L("-- A. Provenance sources");
  L("-- ---------------------------------------------------------------------------");
  for (const s of sot.sources) {
    L(
      `INSERT INTO "ExerciseCatalogSource" (id, code, "displayName", "sourceType", "baseUrl", active)`,
    );
    L(
      `VALUES (${sqlStr(s.id)}, ${sqlStr(s.code)}, ${sqlStr(s.displayName)}, ${sqlStr(s.sourceType)}, ${sqlStr(s.baseUrl)}, true)`,
    );
    L(`ON CONFLICT (code) DO NOTHING;`);
    L("");
  }

  L("-- ---------------------------------------------------------------------------");
  L("-- B. All 36 movement families");
  L("-- ---------------------------------------------------------------------------");
  L(`INSERT INTO "ExerciseFamily" (slug, "nameRu", "nameEn", "movementPattern", "internalNote")`);
  L(`VALUES`);
  sot.families.forEach((f, idx) => {
    const comma = idx === sot.families.length - 1 ? "" : ",";
    L(
      `  (${sqlStr(f.slug)}, ${sqlStr(f.nameRu)}, ${sqlStr(f.nameEn)}, ${sqlStr(f.movementPattern)}, 'Canonical family WORKOUT-CATALOG-01B')${comma}`,
    );
  });
  L(`ON CONFLICT (slug) DO UPDATE SET`);
  L(`  "nameRu" = EXCLUDED."nameRu",`);
  L(`  "nameEn" = EXCLUDED."nameEn",`);
  L(`  "movementPattern" = EXCLUDED."movementPattern",`);
  L(`  "updatedAt" = now();`);
  L("");

  L("-- ---------------------------------------------------------------------------");
  L("-- C. Upsert Exercise identities (20 existing hub refresh + 64 new)");
  L("-- ---------------------------------------------------------------------------");
  for (const ex of sot.exercises) {
    const id = deterministicUuid(`exercise:${ex.key}`);
    L(`INSERT INTO "Exercise" (`);
    L(`  id, name, "riskLevel", key, "nameRu", "nameEn", "displayNameRu", "displayNameEn",`);
    L(`  "techniqueSummaryRu", "techniqueSummaryEn", "commonMistakeRu", "commonMistakeEn",`);
    L(`  "movementPattern", difficulty, "equipmentCodesJson", "muscleGroupsJson",`);
    L(`  "estimatedMinutes", "isActive", "familyId"`);
    L(`)`);
    L(`SELECT`);
    L(`  ${sqlStr(id)},`);
    L(`  ${sqlStr(ex.key)},`);
    L(`  ${sqlStr(ex.riskLevel)},`);
    L(`  ${sqlStr(ex.key)},`);
    L(`  ${sqlStr(ex.nameRu)},`);
    L(`  ${sqlStr(ex.nameEn)},`);
    L(`  ${sqlStr(ex.displayNameRu)},`);
    L(`  ${sqlStr(ex.displayNameEn)},`);
    L(`  ${sqlStr(ex.techniqueRu)},`);
    L(`  NULL,`);
    L(`  ${sqlStr(ex.commonMistakeRu)},`);
    L(`  NULL,`);
    L(`  ${sqlStr(ex.generatorMovementPattern)},`);
    L(`  ${sqlStr(ex.difficulty)},`);
    L(`  ${sqlJson(ex.equipmentCodes)}::jsonb,`);
    L(`  ${sqlJson(ex.muscleGroups)}::jsonb,`);
    L(`  ${ex.estimatedMinutes},`);
    L(`  true,`);
    L(`  f.id`);
    L(`FROM "ExerciseFamily" f`);
    L(`WHERE f.slug = ${sqlStr(ex.familySlug)}`);
    L(`ON CONFLICT (key) WHERE ("key" IS NOT NULL) DO UPDATE SET`);
    L(`  name = EXCLUDED.name,`);
    L(`  "riskLevel" = EXCLUDED."riskLevel",`);
    L(`  "nameRu" = EXCLUDED."nameRu",`);
    L(`  "nameEn" = EXCLUDED."nameEn",`);
    L(`  "displayNameRu" = EXCLUDED."displayNameRu",`);
    L(`  "displayNameEn" = EXCLUDED."displayNameEn",`);
    L(`  "techniqueSummaryRu" = EXCLUDED."techniqueSummaryRu",`);
    L(`  "commonMistakeRu" = EXCLUDED."commonMistakeRu",`);
    L(`  "movementPattern" = EXCLUDED."movementPattern",`);
    L(`  difficulty = EXCLUDED.difficulty,`);
    L(`  "equipmentCodesJson" = EXCLUDED."equipmentCodesJson",`);
    L(`  "muscleGroupsJson" = EXCLUDED."muscleGroupsJson",`);
    L(`  "estimatedMinutes" = EXCLUDED."estimatedMinutes",`);
    L(`  "isActive" = true,`);
    L(`  "familyId" = EXCLUDED."familyId";`);
    L("");
  }

  L("-- Ensure family linkage even if conflict path skipped family for legacy rows.");
  L(`UPDATE "Exercise" e`);
  L(`SET "familyId" = f.id`);
  L(`FROM "ExerciseFamily" f`);
  L(`WHERE e.key IS NOT NULL AND (`);
  sot.exercises.forEach((ex, idx) => {
    const or = idx === 0 ? "" : " OR ";
    L(`  ${or}(e.key = ${sqlStr(ex.key)} AND f.slug = ${sqlStr(ex.familySlug)})`);
  });
  L(`);`);
  L("");

  L("-- ---------------------------------------------------------------------------");
  L("-- D. DRAFT revisions (rev2 for existing 20, rev1 for new 64)");
  L("-- ---------------------------------------------------------------------------");
  for (const ex of sot.exercises) {
    L(`INSERT INTO "ExerciseRevision" (`);
    L(`  "exerciseId", "revisionNumber", status,`);
    L(`  "nameRu", "nameEn",`);
    L(`  "techniqueRu", "techniqueEn",`);
    L(`  "commonMistakeRu", "commonMistakeEn",`);
    L(`  "easierVariantRu", "easierVariantEn",`);
    L(`  "harderVariantRu", "harderVariantEn",`);
    L(`  "breathingRu", "breathingEn",`);
    L(`  "stopConditionsRu", "stopConditionsEn",`);
    L(`  "defaultSets", "defaultRepsMin", "defaultRepsMax",`);
    L(`  "defaultDurationSeconds", "defaultRestSeconds", "estimatedDurationSeconds",`);
    L(`  "createdBy"`);
    L(`)`);
    L(`SELECT`);
    L(`  e.id,`);
    L(`  ${ex.revisionNumber},`);
    L(`  'DRAFT',`);
    L(`  ${sqlStr(ex.nameRu)},`);
    L(`  ${sqlStr(ex.nameEn)},`);
    L(`  ${sqlStr(ex.techniqueRu)},`);
    L(`  NULL,`);
    L(`  ${sqlStr(ex.commonMistakeRu)},`);
    L(`  NULL,`);
    L(`  ${sqlStr(ex.easierVariantRu)},`);
    L(`  NULL,`);
    L(`  NULL,`);
    L(`  NULL,`);
    L(`  ${sqlStr(ex.breathingRu)},`);
    L(`  NULL,`);
    L(`  ${sqlStr(ex.stopConditionsRu)},`);
    L(`  NULL,`);
    L(`  ${ex.defaultSets},`);
    L(`  ${ex.defaultRepsMin == null ? "NULL" : ex.defaultRepsMin},`);
    L(`  ${ex.defaultRepsMax == null ? "NULL" : ex.defaultRepsMax},`);
    L(`  ${ex.defaultDurationSeconds == null ? "NULL" : ex.defaultDurationSeconds},`);
    L(`  ${ex.defaultRestSeconds},`);
    L(`  ${ex.estimatedDurationSeconds},`);
    L(`  ${sqlStr(sot.actor)}`);
    L(`FROM "Exercise" e`);
    L(`WHERE e.key = ${sqlStr(ex.key)}`);
    L(`ON CONFLICT ("exerciseId", "revisionNumber") DO NOTHING;`);
    L("");
  }

  L("-- ---------------------------------------------------------------------------");
  L("-- E. Safety profiles (pre-approval only)");
  L("-- ---------------------------------------------------------------------------");
  for (const ex of sot.exercises) {
    const s = ex.safety;
    L(`INSERT INTO "ExerciseSafetyProfile" (`);
    L(`  "exerciseRevisionId",`);
    L(`  "kneeLoad", "shoulderLoad", "spineLoad",`);
    L(`  "impactLevel", "balanceRequirement",`);
    L(`  "floorRequired", "overheadMovement", "deepKneeFlexion", "singleLeg",`);
    L(`  "beginnerAllowed", "requiresSpotter", "internalSafetyNote"`);
    L(`)`);
    L(`SELECT`);
    L(`  r.id,`);
    L(`  ${sqlStr(s.kneeLoad)}, ${sqlStr(s.shoulderLoad)}, ${sqlStr(s.spineLoad)},`);
    L(`  ${sqlStr(s.impactLevel)}, ${sqlStr(s.balanceRequirement)},`);
    L(`  ${s.floorRequired}, ${s.overheadMovement}, ${s.deepKneeFlexion}, ${s.singleLeg},`);
    L(`  ${s.beginnerAllowed}, false, ${sqlStr(s.internalSafetyNote)}`);
    L(`FROM "ExerciseRevision" r`);
    L(`JOIN "Exercise" e ON e.id = r."exerciseId"`);
    L(`WHERE e.key = ${sqlStr(ex.key)}`);
    L(`  AND r."revisionNumber" = ${ex.revisionNumber}`);
    L(`  AND r.status = 'DRAFT'`);
    L(`  AND r."createdBy" = ${sqlStr(sot.actor)}`);
    L(`ON CONFLICT ("exerciseRevisionId") DO NOTHING;`);
    L("");
  }

  L("-- ---------------------------------------------------------------------------");
  L("-- F. Source references (pre-approval only)");
  L("-- ---------------------------------------------------------------------------");
  for (const ex of sot.exercises) {
    const src = ex.source;
    L(`INSERT INTO "ExerciseSourceReference" (`);
    L(`  "exerciseRevisionId", "sourceId", "externalReference", "factualNotes", "accessedAt"`);
    L(`)`);
    L(`SELECT`);
    L(`  r.id,`);
    L(`  s.id,`);
    L(`  ${sqlStr(src.externalReference)},`);
    L(`  ${sqlStr(src.factualNotes)},`);
    L(`  now()`);
    L(`FROM "ExerciseRevision" r`);
    L(`JOIN "Exercise" e ON e.id = r."exerciseId"`);
    L(`JOIN "ExerciseCatalogSource" s ON s.code = ${sqlStr(src.sourceCode)}`);
    L(`WHERE e.key = ${sqlStr(ex.key)}`);
    L(`  AND r."revisionNumber" = ${ex.revisionNumber}`);
    L(`  AND r.status = 'DRAFT'`);
    L(`  AND r."createdBy" = ${sqlStr(sot.actor)}`);
    L(`  AND NOT EXISTS (`);
    L(`    SELECT 1 FROM "ExerciseSourceReference" x`);
    L(`    WHERE x."exerciseRevisionId" = r.id AND x."sourceId" = s.id`);
    L(`  );`);
    L("");
  }

  L("-- ---------------------------------------------------------------------------");
  L("-- G. Approve DRAFT revisions (triggers set approvedAt)");
  L("-- ---------------------------------------------------------------------------");
  L(`UPDATE "ExerciseRevision" r`);
  L(`SET status = 'APPROVED',`);
  L(`    "reviewedAt" = COALESCE(r."reviewedAt", now())`);
  L(`WHERE r.status = 'DRAFT'`);
  L(`  AND r."createdBy" = ${sqlStr(sot.actor)}`);
  L(`  AND EXISTS (`);
  L(`    SELECT 1 FROM "ExerciseSafetyProfile" sp WHERE sp."exerciseRevisionId" = r.id`);
  L(`  )`);
  L(`  AND EXISTS (`);
  L(`    SELECT 1 FROM "ExerciseSourceReference" sr WHERE sr."exerciseRevisionId" = r.id`);
  L(`  );`);
  L("");

  L("-- ---------------------------------------------------------------------------");
  L("-- H. Candidate / variant graph (content basis for 01D)");
  L("-- ---------------------------------------------------------------------------");
  for (const ex of sot.exercises) {
    for (const alt of ex.candidates.alternatives) {
      L(`INSERT INTO "ExerciseVariantRelation" (`);
      L(`  "fromExerciseId", "toExerciseId", "relationType", priority, "levelDelta", active`);
      L(`)`);
      L(
        `SELECT src.id, dst.id, ${sqlStr(alt.relationType)}, ${alt.priority}, ${alt.levelDelta}, true`,
      );
      L(`FROM "Exercise" src`);
      L(`JOIN "Exercise" dst ON dst.key = ${sqlStr(alt.key)}`);
      L(`WHERE src.key = ${sqlStr(ex.key)} AND src.id <> dst.id`);
      L(
        `ON CONFLICT ("fromExerciseId", "toExerciseId", "relationType", "equipmentContext", "placeContext") DO UPDATE SET`,
      );
      L(`  priority = EXCLUDED.priority,`);
      L(`  "levelDelta" = EXCLUDED."levelDelta",`);
      L(`  active = EXCLUDED.active;`);
      L("");
    }
  }

  L(
    "-- Drop leftover non-SoT edges owned by canonical sources (01A priority=100 leftovers, etc.).",
  );
  L("-- Exact from/to/type triples only — no family-wide or table-wide wipe.");
  {
    const allowed = [];
    for (const ex of sot.exercises) {
      for (const alt of ex.candidates.alternatives) {
        allowed.push(`(${sqlStr(ex.key)}, ${sqlStr(alt.key)}, ${sqlStr(alt.relationType)})`);
      }
    }
    L(`WITH allowed(from_key, to_key, relation_type) AS (`);
    L(`  VALUES`);
    for (let i = 0; i < allowed.length; i += 1) {
      L(`    ${allowed[i]}${i + 1 < allowed.length ? "," : ""}`);
    }
    L(`)`);
    L(`DELETE FROM "ExerciseVariantRelation" vr`);
    L(`USING "Exercise" f, "Exercise" t`);
    L(`WHERE vr."fromExerciseId" = f.id`);
    L(`  AND vr."toExerciseId" = t.id`);
    L(`  AND f.key IN (${sot.exercises.map((e) => sqlStr(e.key)).join(", ")})`);
    L(`  AND NOT EXISTS (`);
    L(`    SELECT 1 FROM allowed a`);
    L(`    WHERE a.from_key = f.key`);
    L(`      AND a.to_key = t.key`);
    L(`      AND a.relation_type = vr."relationType"`);
    L(`  );`);
    L("");
  }

  L("-- ---------------------------------------------------------------------------");
  L("-- I. Canonical DRAFT release + 84 items");
  L("-- ---------------------------------------------------------------------------");
  const releaseId = deterministicUuid("release:workout-catalog-canonical-01b");
  L(`INSERT INTO "WorkoutCatalogRelease" (`);
  L(`  id, code, status, "manifestVersion", "createdBy", notes`);
  L(`)`);
  L(`VALUES (`);
  L(`  ${sqlStr(releaseId)},`);
  L(`  ${sqlStr(sot.releaseCode)},`);
  L(`  'DRAFT',`);
  L(`  ${sqlStr(sot.manifestVersion)},`);
  L(`  ${sqlStr(sot.actor)},`);
  L(`  'Canonical 84-exercise PUBLISHED catalog for WORKOUT-CATALOG-01B'`);
  L(`)`);
  L(`ON CONFLICT (code) DO NOTHING;`);
  L("");

  for (const ex of sot.exercises) {
    L(`INSERT INTO "WorkoutCatalogReleaseItem" (`);
    L(
      `  "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"`,
    );
    L(`)`);
    L(`SELECT`);
    L(`  rel.id, e.id, r.id, e."familyId", ${ex.ordinal}, true`);
    L(`FROM "WorkoutCatalogRelease" rel`);
    L(`JOIN "Exercise" e ON e.key = ${sqlStr(ex.key)}`);
    L(`JOIN "ExerciseRevision" r`);
    L(`  ON r."exerciseId" = e.id`);
    L(` AND r."revisionNumber" = ${ex.revisionNumber}`);
    L(` AND r.status = 'APPROVED'`);
    L(`WHERE rel.code = ${sqlStr(sot.releaseCode)}`);
    L(`  AND rel.status = 'DRAFT'`);
    L(`  AND e."familyId" IS NOT NULL`);
    L(`ON CONFLICT ("releaseId", "exerciseId") DO NOTHING;`);
    L("");
  }

  L("-- ---------------------------------------------------------------------------");
  L("-- J. Atomic publish under advisory lock 21000101");
  L("-- ---------------------------------------------------------------------------");
  L(`DO $publish$`);
  L(`BEGIN`);
  L(`  PERFORM pg_advisory_xact_lock(21000101);`);
  L("");
  L(`  IF NOT EXISTS (`);
  L(`    SELECT 1 FROM "WorkoutCatalogRelease"`);
  L(`    WHERE code = ${sqlStr(sot.releaseCode)} AND status = 'DRAFT'`);
  L(`  ) THEN`);
  L(`    -- Already published or absent: idempotent no-op for publish step.`);
  L(`    RETURN;`);
  L(`  END IF;`);
  L("");
  L(`  IF (`);
  L(`    SELECT COUNT(*) FROM "WorkoutCatalogReleaseItem" i`);
  L(`    JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"`);
  L(`    WHERE rel.code = ${sqlStr(sot.releaseCode)}`);
  L(`  ) <> 84 THEN`);
  L(`    RAISE EXCEPTION 'WORKOUT_CATALOG_01B_RELEASE_ITEM_COUNT';`);
  L(`  END IF;`);
  L("");
  L(`  UPDATE "WorkoutCatalogRelease"`);
  L(`  SET status = 'RETIRED',`);
  L(`      "retiredAt" = COALESCE("retiredAt", now())`);
  L(`  WHERE status = 'PUBLISHED'`);
  L(`    AND code <> ${sqlStr(sot.releaseCode)};`);
  L("");
  L(`  UPDATE "WorkoutCatalogRelease"`);
  L(`  SET status = 'PUBLISHED',`);
  L(`      "publishedAt" = COALESCE("publishedAt", now()),`);
  L(`      "retiredAt" = NULL`);
  L(`  WHERE code = ${sqlStr(sot.releaseCode)}`);
  L(`    AND status = 'DRAFT';`);
  L("");
  L(`  IF (SELECT COUNT(*) FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED') <> 1 THEN`);
  L(`    RAISE EXCEPTION 'WORKOUT_CATALOG_01B_PUBLISHED_COUNT';`);
  L(`  END IF;`);
  L(`END`);
  L(`$publish$;`);
  L("");

  return lines.join("\n");
}

const args = process.argv.slice(2);
const check = args.includes("--check") || process.env.WORKOUT_CATALOG_01B_CHECK === "1";
if (args.length > 1 || (args.length === 1 && !check)) {
  throw new Error("Usage: node generate-workout-catalog-01b.mjs [--check]");
}

await ensureManifestDump();
const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
if (!Array.isArray(dump.entries) || dump.entries.length !== 84) {
  throw new Error(`Expected 84 manifest entries in dump, got ${dump.entries?.length}`);
}
const entries = [...dump.entries].sort(compareEntries);
assertBodiesComplete(entries.map((entry) => entry.slug));

const sot = buildCanonical(entries);
if (sot.families.length !== 36) throw new Error(`Expected 36 families, got ${sot.families.length}`);
if (sot.exercises.length !== 84)
  throw new Error(`Expected 84 exercises, got ${sot.exercises.length}`);

const sotOutput = `${JSON.stringify(sot, null, 2)}\n`;
const migrationOutput = `${emitMigration(sot)}\n`;
if (check) {
  const drift = [
    [sotPath, sotOutput],
    [migPath, migrationOutput],
  ].filter(([path, expected]) => !existsSync(path) || readFileSync(path, "utf8") !== expected);
  if (drift.length) {
    console.error(`WORKOUT-CATALOG-01B drift: ${drift.map(([path]) => path).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.info(
      "WORKOUT-CATALOG-01B check passed: canonical SoT and migration 211 are byte-identical.",
    );
  }
} else {
  mkdirSync(migDir, { recursive: true });
  writeFileSync(sotPath, sotOutput, "utf8");
  writeFileSync(migPath, migrationOutput, "utf8");
}

console.info(
  JSON.stringify(
    {
      sotPath,
      migPath,
      exercises: sot.counts.exercises,
      families: sot.counts.families,
      existing: sot.counts.existingTreatedWithNewRevision,
      newlyCreated: sot.counts.newlyCreated,
      candidateExceptions: sot.candidateExceptions.length,
      mode: check ? "check" : "write",
      migrationBytes: Buffer.byteLength(migrationOutput),
    },
    null,
    2,
  ),
);
