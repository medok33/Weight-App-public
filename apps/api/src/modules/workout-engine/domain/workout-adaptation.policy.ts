import type { CatalogExercise, TrainingLevel, WorkoutEquipmentCode } from "./workout-engine.types";
import { computeOptionFingerprint } from "./workout-adaptation.fingerprint";
import {
  GOAL_IMPACT_DISCLAIMER_RU,
  WORKOUT_ADAPTATION_INTENT_LABELS_RU,
  WORKOUT_ADAPTATION_POLICY_VERSION,
  type AdaptationExerciseSnapshot,
  type AdaptationOption,
  type AdaptationPreview,
  type AdaptationSessionSnapshot,
  type GoalImpactCategory,
  type GoalImpactSnapshot,
  type WorkoutAdaptationIntent,
} from "./workout-adaptation.types";

type AdaptationOptionDraft = Omit<AdaptationOption, "optionFingerprint">;

const LEVEL_RANK: Record<TrainingLevel, number> = {
  BEGINNER: 1,
  INTERMEDIATE: 2,
  ADVANCED: 3,
};

const FORBIDDEN_PROMISE_PATTERNS = [
  /точно\s+сожж/i,
  /результат\s+не\s+пострадает/i,
  /\d+\s*г(рамм)?\w*\s+жира/i,
  /потеряете\s+\d+/i,
  /гарантир/i,
];

export type VariantEdge = {
  fromKey: string;
  toKey: string;
  relationType: string;
  priority: number;
  levelDelta: number;
};

export type AdaptationPolicyInput = {
  intent: WorkoutAdaptationIntent;
  session: AdaptationSessionSnapshot;
  catalog: CatalogExercise[];
  edges: VariantEdge[];
  profile: {
    trainingLevel: TrainingLevel;
    workoutEquipment: WorkoutEquipmentCode[];
    excludedExerciseKeys: string[];
  };
  weekDays?: Array<{
    dayIndex: number;
    isRestDay: boolean;
    exerciseKeys: string[];
  }>;
  completedDayIndexes?: number[];
  todayDayIndex?: number;
  timeZone?: string;
};

function approxMinutes(exercises: AdaptationExerciseSnapshot[]): { min: number; max: number } {
  if (exercises.length === 0) return { min: 10, max: 15 };
  let total = 0;
  for (const ex of exercises) {
    if (ex.targetDurationSeconds != null) {
      total += Math.ceil(ex.targetDurationSeconds / 60);
      continue;
    }
    const sets = Math.max(1, ex.targetSets);
    const reps = ex.targetRepsMax ?? ex.targetRepsMin ?? 10;
    const rest = (ex.restSeconds ?? 60) / 60;
    total += sets * Math.max(0.5, reps * 0.05) + Math.max(0, sets - 1) * rest;
  }
  const rounded = Math.max(8, Math.round(total));
  return { min: Math.max(5, rounded - 3), max: rounded + 3 };
}

function catalogByKey(catalog: CatalogExercise[]): Map<string, CatalogExercise> {
  return new Map(catalog.filter((c) => c.key).map((c) => [c.key, c]));
}

function equipmentOk(ex: CatalogExercise, allowed: Set<string>): boolean {
  const req = (ex.equipmentCodes ?? []).map((c) => String(c).toUpperCase());
  if (req.length === 0 || req.every((c) => c === "NONE" || c === "BODYWEIGHT")) return true;
  return req.every((c) => allowed.has(c) || c === "NONE" || c === "BODYWEIGHT");
}

function levelOk(ex: CatalogExercise, level: TrainingLevel): boolean {
  return LEVEL_RANK[ex.difficulty] <= LEVEL_RANK[level];
}

function isHomeFriendly(ex: CatalogExercise): boolean {
  const codes = (ex.equipmentCodes ?? []).map((c) => String(c).toUpperCase());
  if (codes.some((c) => c === "BARBELL" || c === "GYM_MACHINES" || c === "CABLE" || c === "SMITH")) {
    return false;
  }
  return true;
}

export function buildGoalImpact(
  intent: WorkoutAdaptationIntent,
  category: GoalImpactCategory,
  extras: Partial<GoalImpactSnapshot> = {},
): GoalImpactSnapshot {
  const base: Record<GoalImpactCategory, Omit<GoalImpactSnapshot, "policyVersion" | "impactCategory" | "disclaimerRu">> = {
    GOAL_PRESERVED: {
      trainingStimulus: "unchanged",
      durationChange: "unchanged",
      recoveryEffect: "unchanged",
      weeklyConsistency: "preserved",
      summaryRu: "Основная цель тренировки сохранится.",
      detailsRu: ["Содержание остаётся близким к исходному плану."],
    },
    MOSTLY_PRESERVED: {
      trainingStimulus: "slightly_lower",
      durationChange: "slightly_shorter",
      recoveryEffect: "unchanged",
      weeklyConsistency: "preserved",
      summaryRu: "Нагрузка станет немного ниже, но план останется последовательным.",
      detailsRu: ["Ключевые движения сохраняются в более спокойном варианте."],
    },
    RECOVERY_PRIORITY: {
      trainingStimulus: "recovery",
      durationChange: "shorter",
      recoveryEffect: "higher",
      weeklyConsistency: "preserved",
      summaryRu: "Сегодня будет меньше тренировочного стимула, зато больше восстановления.",
      detailsRu: [
        "Интенсивность снизится.",
        "Восстановление повысится.",
        "Привычка и недельная последовательность сохраняются.",
        "Исходный тренировочный стимул будет частично уменьшен.",
      ],
    },
    SCHEDULE_ONLY: {
      trainingStimulus: "unchanged",
      durationChange: "unchanged",
      recoveryEffect: "unchanged",
      weeklyConsistency: "adjusted",
      summaryRu: "Меняется только день выполнения — содержание тренировки сохраняется.",
      detailsRu: ["Упражнения и объём остаются прежними."],
    },
    NOTICEABLE_REDUCTION: {
      trainingStimulus: "lower",
      durationChange: "shorter",
      recoveryEffect: "slightly_higher",
      weeklyConsistency: "preserved",
      summaryRu: "Тренировка станет заметно короче и спокойнее при сохранении структуры.",
      detailsRu: ["Разминка и основной блок сохраняются в сокращённом виде."],
    },
  };

  const selected = base[category];
  const impact: GoalImpactSnapshot = {
    policyVersion: WORKOUT_ADAPTATION_POLICY_VERSION,
    impactCategory: category,
    ...selected,
    ...extras,
    detailsRu: extras.detailsRu ?? selected.detailsRu,
    disclaimerRu: GOAL_IMPACT_DISCLAIMER_RU,
  };

  assertNonMedicalLanguage(impact);
  void intent;
  return impact;
}

export function assertNonMedicalLanguage(impact: GoalImpactSnapshot): void {
  const text = [impact.summaryRu, ...impact.detailsRu, impact.disclaimerRu].join("\n");
  for (const pattern of FORBIDDEN_PROMISE_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error("WORKOUT_ADAPTATION_LANGUAGE_INVALID");
    }
  }
}

function preferredEdges(fromKey: string, edges: VariantEdge[]): VariantEdge[] {
  return edges
    .filter(
      (e) =>
        e.fromKey === fromKey &&
        e.priority === 0 &&
        (e.relationType === "EASIER" || e.relationType === "SAME_LEVEL" || e.relationType === "HOME_ALTERNATIVE" || e.relationType === "NO_EQUIPMENT"),
    )
    .sort((a, b) => a.priority - b.priority || a.toKey.localeCompare(b.toKey));
}

function easierEdges(fromKey: string, edges: VariantEdge[]): VariantEdge[] {
  return edges
    .filter((e) => e.fromKey === fromKey && (e.relationType === "EASIER" || (e.relationType === "SAME_LEVEL" && e.priority === 0)))
    .sort((a, b) => a.priority - b.priority || a.toKey.localeCompare(b.toKey));
}

function cloneSession(
  session: AdaptationSessionSnapshot,
  patch: Partial<AdaptationSessionSnapshot> & { exercises?: AdaptationExerciseSnapshot[] },
): AdaptationSessionSnapshot {
  return {
    ...session,
    ...patch,
    exercises: (patch.exercises ?? session.exercises).map((e) => ({ ...e })),
  };
}

function seedFromCatalog(
  base: AdaptationExerciseSnapshot,
  cat: CatalogExercise,
  releaseId: string | null,
  overrides: Partial<AdaptationExerciseSnapshot> = {},
): AdaptationExerciseSnapshot {
  return {
    ...base,
    exerciseKey: cat.key,
    sourceExerciseId: cat.id ?? null,
    exerciseRevisionId: cat.exerciseRevisionId ?? null,
    catalogReleaseId: releaseId,
    displayNameRu: cat.displayNameRu ?? cat.nameRu ?? cat.name,
    displayNameEn: cat.displayNameEn ?? cat.nameEn ?? cat.name,
    techniqueSummaryRu: cat.techniqueSummaryRu ?? null,
    techniqueSummaryEn: cat.techniqueSummaryEn ?? null,
    commonMistakeRu: cat.commonMistakeRu ?? null,
    commonMistakeEn: cat.commonMistakeEn ?? null,
    easierVariantRu: cat.easierVariantRu ?? null,
    easierVariantEn: cat.easierVariantEn ?? null,
    breathingRu: cat.breathingRu ?? null,
    breathingEn: cat.breathingEn ?? null,
    stopConditionsRu: cat.stopConditionsRu ?? null,
    stopConditionsEn: cat.stopConditionsEn ?? null,
    ...overrides,
  };
}

function isStrengthKey(key: string | null): boolean {
  if (!key) return false;
  return !["rest", "recovery_walk", "morning_walk", "stretching", "mobility_flow"].includes(key);
}

function pickHomeCandidate(
  fromKey: string,
  catalogMap: Map<string, CatalogExercise>,
  edges: VariantEdge[],
  allowedEquipment: Set<string>,
  level: TrainingLevel,
  excluded: Set<string>,
): CatalogExercise | null {
  const ranked = preferredEdges(fromKey, edges);
  for (const edge of ranked) {
    if (edge.relationType === "HARDER" || edge.relationType === "ADVANCED") continue;
    const cand = catalogMap.get(edge.toKey);
    if (!cand) continue;
    if (excluded.has(cand.key)) continue;
    if (!cand.isActive) continue;
    if (!levelOk(cand, level)) continue;
    if (!equipmentOk(cand, allowedEquipment)) continue;
    if (!isHomeFriendly(cand)) continue;
    return cand;
  }
  const self = catalogMap.get(fromKey);
  if (self && isHomeFriendly(self) && equipmentOk(self, allowedEquipment) && levelOk(self, level) && !excluded.has(fromKey)) {
    return self;
  }
  return null;
}

function buildHomeOptions(input: AdaptationPolicyInput): AdaptationOptionDraft[] {
  const catalogMap = catalogByKey(input.catalog);
  const allowed = new Set(input.profile.workoutEquipment.map((c) => String(c).toUpperCase()));
  if (allowed.size === 0) allowed.add("NONE").add("BODYWEIGHT");
  const excluded = new Set(input.profile.excludedExerciseKeys);
  const releaseId = input.session.catalogReleaseId;
  const before = approxMinutes(input.session.exercises);

  const buildVariant = (code: string, titleRu: string, preferBodyweight: boolean): AdaptationOptionDraft | null => {
    const nextExercises: AdaptationExerciseSnapshot[] = [];
    let changed = 0;
    for (const ex of input.session.exercises) {
      const key = ex.exerciseKey;
      if (!key || !isStrengthKey(key)) {
        nextExercises.push({ ...ex });
        continue;
      }
      let cand = pickHomeCandidate(
        key,
        catalogMap,
        input.edges,
        preferBodyweight ? new Set(["NONE", "BODYWEIGHT", "RESISTANCE_BAND"]) : allowed,
        input.profile.trainingLevel,
        excluded,
      );
      if (!cand) cand = pickHomeCandidate(key, catalogMap, input.edges, allowed, input.profile.trainingLevel, excluded);
      if (!cand) return null;
      if (cand.key !== key) changed += 1;
      nextExercises.push(seedFromCatalog(ex, cand, releaseId));
    }
    if (changed === 0 && input.session.exercises.every((e) => {
      const c = e.exerciseKey ? catalogMap.get(e.exerciseKey) : null;
      return !c || isHomeFriendly(c);
    })) {
      // Already home-compatible — still offer a confirmed HOME option with GOAL_PRESERVED.
    }
    const afterSnap = cloneSession(input.session, {
      dayTitle: "Домашняя тренировка",
      exercises: nextExercises,
      estimatedMinutes: approxMinutes(nextExercises).max,
    });
    const after = approxMinutes(nextExercises);
    return {
      optionCode: code,
      recommended: false,
      titleRu,
      summaryRu: changed === 0
        ? "Тренировка уже подходит для дома — структура сохраняется."
        : `Заменим примерно ${changed} упражнени${changed === 1 ? "е" : "я"} на домашние варианты.`,
      estimatedMinutesBefore: before,
      estimatedMinutesAfter: after,
      goalImpact: buildGoalImpact("HOME", changed === 0 ? "GOAL_PRESERVED" : "MOSTLY_PRESERVED"),
      preview: afterSnap,
    };
  };

  const options = [
    buildVariant("HOME_SAFE_MIN_EQUIP", "Дома с минимумом оборудования", true),
    buildVariant("HOME_PROFILE_EQUIP", "Дома с вашим оборудованием", false),
    buildVariant("HOME_BAND_FOCUS", "Домашний вариант с акцентом на доступность", true),
  ].filter((o): o is AdaptationOptionDraft => Boolean(o));

  // Deduplicate by exercise key sequence
  const seen = new Set<string>();
  const unique: AdaptationOptionDraft[] = [];
  for (const opt of options) {
    const sig = opt.preview.exercises.map((e) => e.exerciseKey).join("|");
    if (seen.has(sig)) continue;
    seen.add(sig);
    unique.push(opt);
  }
  if (unique[0]) unique[0].recommended = true;
  return unique.slice(0, 5);
}

function buildShorterOptions(input: AdaptationPolicyInput): AdaptationOptionDraft[] {
  const before = approxMinutes(input.session.exercises);
  const strength = input.session.exercises.filter((e) => isStrengthKey(e.exerciseKey));
  const accessories = strength.slice(Math.ceil(strength.length / 2));
  const main = strength.slice(0, Math.max(1, Math.ceil(strength.length / 2)));
  const warmCooldown = input.session.exercises.filter((e) => !isStrengthKey(e.exerciseKey));

  const mk = (
    code: string,
    titleRu: string,
    keepAccessoryCount: number,
    setDelta: number,
    category: GoalImpactCategory,
  ): AdaptationOptionDraft => {
    const keptAccessories = accessories.slice(0, keepAccessoryCount);
    const exercises = [...warmCooldown.slice(0, 1), ...main, ...keptAccessories, ...warmCooldown.slice(1)]
      .filter((e, idx, arr) => arr.findIndex((x) => x.orderIndex === e.orderIndex && x.exerciseKey === e.exerciseKey) === idx)
      .map((e, orderIndex) => ({
        ...e,
        orderIndex,
        targetSets:
          e.targetDurationSeconds != null ? 1 : Math.max(1, e.targetSets + setDelta),
      }));
    // Ensure at least one main + not empty
    const ensured = exercises.length > 0
      ? exercises
      : main.map((e, orderIndex) => ({
          ...e,
          orderIndex,
          targetSets: e.targetDurationSeconds != null ? 1 : Math.max(1, e.targetSets - 1),
        }));
    const after = approxMinutes(ensured);
    return {
      optionCode: code,
      recommended: false,
      titleRu,
      summaryRu: `Примерно ${before.min}–${before.max} мин → около ${after.min}–${after.max} мин.`,
      estimatedMinutesBefore: before,
      estimatedMinutesAfter: after,
      estimatedMinutesSaved: {
        min: Math.max(0, before.min - after.max),
        max: Math.max(0, before.max - after.min),
      },
      goalImpact: buildGoalImpact("SHORTER", category),
      preview: cloneSession(input.session, {
        dayTitle: "Сокращённая тренировка",
        estimatedMinutes: after.max,
        exercises: ensured,
      }),
    };
  };

  const options = [
    mk("SHORTER_SMALL", "Небольшое сокращение", Math.max(0, accessories.length - 1), 0, "MOSTLY_PRESERVED"),
    mk("SHORTER_MEDIUM", "Среднее сокращение", Math.max(0, Math.floor(accessories.length / 2)), -1, "NOTICEABLE_REDUCTION"),
    mk("SHORTER_MAX_SAFE", "Максимально безопасное сокращение", 0, -1, "NOTICEABLE_REDUCTION"),
  ];
  options[0]!.recommended = true;
  return options;
}

function buildLighterOptions(input: AdaptationPolicyInput): AdaptationOptionDraft[] {
  const catalogMap = catalogByKey(input.catalog);
  const allowed = new Set(input.profile.workoutEquipment.map((c) => String(c).toUpperCase()));
  const excluded = new Set(input.profile.excludedExerciseKeys);
  const releaseId = input.session.catalogReleaseId;
  const before = approxMinutes(input.session.exercises);

  const replaceWithEasier = (alsoReduceSets: boolean, restBonus: number, code: string, titleRu: string): AdaptationOptionDraft => {
    const exercises = input.session.exercises.map((ex) => {
      const key = ex.exerciseKey;
      if (!key || !isStrengthKey(key)) return { ...ex, restSeconds: (ex.restSeconds ?? 60) + restBonus };
      const edge = easierEdges(key, input.edges).find((e) => {
        const cand = catalogMap.get(e.toKey);
        return (
          cand &&
          !excluded.has(cand.key) &&
          levelOk(cand, input.profile.trainingLevel) &&
          equipmentOk(cand, allowed) &&
          e.relationType !== "HARDER"
        );
      });
      const cand = edge ? catalogMap.get(edge.toKey) : null;
      const base = cand ? seedFromCatalog(ex, cand, releaseId) : { ...ex };
      return {
        ...base,
        targetSets:
          base.targetDurationSeconds != null
            ? 1
            : alsoReduceSets
              ? Math.max(1, ex.targetSets - 1)
              : base.targetSets,
        targetRepsMax: alsoReduceSets && ex.targetRepsMax != null ? Math.max(ex.targetRepsMin ?? 6, ex.targetRepsMax - 2) : base.targetRepsMax,
        restSeconds: (base.restSeconds ?? 60) + restBonus,
      };
    });
    const after = approxMinutes(exercises);
    return {
      optionCode: code,
      recommended: false,
      titleRu,
      summaryRu: "Сохраняем движение, снижаем сложность и темп.",
      estimatedMinutesBefore: before,
      estimatedMinutesAfter: after,
      goalImpact: buildGoalImpact("LIGHTER", "MOSTLY_PRESERVED"),
      preview: cloneSession(input.session, {
        dayTitle: "Облегчённая тренировка",
        estimatedMinutes: after.max,
        exercises,
      }),
    };
  };

  const options = [
    replaceWithEasier(false, 15, "LIGHTER_EASIER_SWAP", "Более лёгкие варианты упражнений"),
    replaceWithEasier(true, 15, "LIGHTER_FEWER_SETS", "Легче и меньше подходов"),
    replaceWithEasier(true, 30, "LIGHTER_CALMER_TEMPO", "Спокойный темп с увеличенным отдыхом"),
  ];
  options[0]!.recommended = true;
  return options.slice(0, 5);
}

function buildWalkRecoveryOptions(input: AdaptationPolicyInput): AdaptationOptionDraft[] {
  const catalogMap = catalogByKey(input.catalog);
  const releaseId = input.session.catalogReleaseId;
  const before = approxMinutes(input.session.exercises);

  const mk = (key: string, code: string, titleRu: string, minutes: number, durationSeconds: number): AdaptationOptionDraft | null => {
    const cat = catalogMap.get(key);
    if (!cat || !cat.exerciseRevisionId) return null;
    const exercise = seedFromCatalog(
      {
        orderIndex: 0,
        exerciseKey: key,
        sourceExerciseId: cat.id ?? null,
        exerciseRevisionId: cat.exerciseRevisionId,
        catalogReleaseId: releaseId,
        displayNameRu: cat.displayNameRu ?? cat.name,
        displayNameEn: cat.displayNameEn ?? cat.name,
        targetSets: 1,
        targetRepsMin: null,
        targetRepsMax: null,
        targetDurationSeconds: durationSeconds,
        restSeconds: 0,
        techniqueSummaryRu: cat.techniqueSummaryRu ?? null,
        techniqueSummaryEn: cat.techniqueSummaryEn ?? null,
        commonMistakeRu: cat.commonMistakeRu ?? null,
        commonMistakeEn: cat.commonMistakeEn ?? null,
        easierVariantRu: cat.easierVariantRu ?? null,
        easierVariantEn: cat.easierVariantEn ?? null,
        breathingRu: cat.breathingRu ?? null,
        breathingEn: cat.breathingEn ?? null,
        stopConditionsRu: cat.stopConditionsRu ?? null,
        stopConditionsEn: cat.stopConditionsEn ?? null,
        media: [],
      },
      cat,
      releaseId,
      { targetDurationSeconds: durationSeconds, targetSets: 1, restSeconds: 0 },
    );
    return {
      optionCode: code,
      recommended: false,
      titleRu,
      summaryRu: "Заменим тренировку на спокойную восстановительную активность.",
      estimatedMinutesBefore: before,
      estimatedMinutesAfter: { min: minutes - 2, max: minutes + 2 },
      goalImpact: buildGoalImpact("WALK_RECOVERY", "RECOVERY_PRIORITY"),
      preview: cloneSession(input.session, {
        dayTitle: titleRu,
        estimatedMinutes: minutes,
        exercises: [exercise],
      }),
    };
  };

  const options = [
    mk("morning_walk", "WALK_EASY", "Спокойная прогулка", 30, 30 * 60),
    mk("recovery_walk", "WALK_RECOVERY_SHORT", "Короткая восстановительная активность", 20, 20 * 60),
    mk("stretching", "MOBILITY_RECOVERY", "Mobility / восстановление", 15, 15 * 60),
  ].filter((o): o is AdaptationOptionDraft => Boolean(o));
  if (options[0]) options[0].recommended = true;
  return options.slice(0, 5);
}

function isOccupiedDay(day: { isRestDay: boolean; exerciseKeys: string[] }): boolean {
  if (day.isRestDay) return false;
  return day.exerciseKeys.some((k) => k && k !== "rest");
}

function isStrengthDay(day: { isRestDay: boolean; exerciseKeys: string[] }): boolean {
  if (day.isRestDay) return false;
  const keys = day.exerciseKeys.filter(Boolean);
  if (keys.length === 0) return false;
  return keys.some((k) => isStrengthKey(k));
}

export function listMoveDayTargets(
  sourceDayIndex: number,
  weekDays: AdaptationPolicyInput["weekDays"] = [],
  completedDayIndexes: number[] = [],
  todayDayIndex = 0,
): number[] {
  const byIndex = new Map(weekDays.map((d) => [d.dayIndex, d]));
  const source = byIndex.get(sourceDayIndex) ?? {
    dayIndex: sourceDayIndex,
    isRestDay: false,
    exerciseKeys: ["strength"],
  };
  const targets: number[] = [];
  for (let offset = 1; offset <= 6; offset += 1) {
    const candidate = (sourceDayIndex + offset) % 7;
    if (completedDayIndexes.includes(candidate)) continue;
    // Do not move into the past relative to today within the week window.
    if (candidate < todayDayIndex && sourceDayIndex >= todayDayIndex) continue;
    const target = byIndex.get(candidate) ?? { dayIndex: candidate, isRestDay: true, exerciseKeys: [] };
    if (isOccupiedDay(target)) continue;
    if (isStrengthDay(source)) {
      const neighbors = [candidate - 1, candidate + 1]
        .filter((d) => d >= 0 && d <= 6 && d !== sourceDayIndex)
        .map((d) => byIndex.get(d))
        .filter(Boolean);
      if (neighbors.some((d) => d && isStrengthDay(d))) continue;
    }
    targets.push(candidate);
  }
  return targets;
}

function buildMoveDayOptions(input: AdaptationPolicyInput): AdaptationOptionDraft[] {
  const targets = listMoveDayTargets(
    input.session.effectiveDayIndex,
    input.weekDays,
    input.completedDayIndexes,
    input.todayDayIndex ?? 0,
  );
  const before = approxMinutes(input.session.exercises);
  const options: AdaptationOptionDraft[] = targets.slice(0, 5).map((dayIndex, i) => ({
    optionCode: `MOVE_DAY_${dayIndex}`,
    recommended: i === 0,
    titleRu: `Перенести на день ${dayIndex + 1}`,
    summaryRu: `Текущий день ${input.session.effectiveDayIndex + 1} → день ${dayIndex + 1}. Содержание сохранится.`,
    estimatedMinutesBefore: before,
    estimatedMinutesAfter: before,
    moveTargetDayIndex: dayIndex,
    goalImpact: buildGoalImpact("MOVE_DAY", "SCHEDULE_ONLY"),
    preview: cloneSession(input.session, {
      effectiveDayIndex: dayIndex,
      dayTitle: "Перенесённая тренировка",
    }),
  }));
  return options;
}

export function buildAdaptationPreview(input: AdaptationPolicyInput): AdaptationPreview {
  const builders: Record<WorkoutAdaptationIntent, () => AdaptationOptionDraft[]> = {
    HOME: () => buildHomeOptions(input),
    SHORTER: () => buildShorterOptions(input),
    LIGHTER: () => buildLighterOptions(input),
    WALK_RECOVERY: () => buildWalkRecoveryOptions(input),
    MOVE_DAY: () => buildMoveDayOptions(input),
  };
  const drafts = builders[input.intent]();
  const options: AdaptationOption[] = drafts.map((draft) => ({
    ...draft,
    optionFingerprint: computeOptionFingerprint({
      intent: input.intent,
      optionCode: draft.optionCode,
      policyVersion: WORKOUT_ADAPTATION_POLICY_VERSION,
      catalogReleaseId: input.session.catalogReleaseId,
      sessionVersion: input.session.version,
      option: { ...draft, optionFingerprint: "" },
    }),
  }));
  const recommended = options.find((o) => o.recommended) ?? options[0] ?? null;
  const alternatives = options.filter((o) => o !== recommended);
  return {
    intent: input.intent,
    intentLabelRu: WORKOUT_ADAPTATION_INTENT_LABELS_RU[input.intent],
    policyVersion: WORKOUT_ADAPTATION_POLICY_VERSION,
    sessionId: input.session.id,
    sessionVersion: input.session.version,
    catalogReleaseId: input.session.catalogReleaseId,
    timeZone: input.timeZone ?? "UTC",
    recommended,
    alternatives,
    unavailableReasonRu:
      options.length === 0
        ? "Сейчас нет безопасных вариантов для этого изменения."
        : null,
  };
}

export function findOption(preview: AdaptationPreview, optionCode: string): AdaptationOption | null {
  if (preview.recommended?.optionCode === optionCode) return preview.recommended;
  return preview.alternatives.find((o) => o.optionCode === optionCode) ?? null;
}

export function recommendedIsNeverHarder(option: AdaptationOption, edges: VariantEdge[]): boolean {
  void edges;
  return !option.optionCode.includes("HARDER");
}
