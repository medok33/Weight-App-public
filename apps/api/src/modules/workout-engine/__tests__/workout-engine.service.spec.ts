import { describe, expect, it } from 'vitest';
import { WorkoutEngineService } from '../application/workout-engine.service';
import type {
  CatalogExercise,
  WorkoutPlanDayDetail,
  WorkoutPlanDayOverride,
  WorkoutPlanDetail,
  WorkoutPlanSaveMeta,
  WorkoutProfile,
  WorkoutProfilePatch,
  WorkoutReplacementType,
} from '../domain/workout-engine.types';
import { ALGORITHM_VERSION } from '../domain/workout-plan-generator';

class MemoryWorkoutRepository {
  private readonly plans = new Map<
    string,
    { id: string; version: number; status?: string; algorithmVersion?: string; plan: WorkoutPlanDetail }[]
  >();
  catalog: CatalogExercise[] = [
    { id: 'e1', key: 'bodyweight_squats', name: 'bodyweight_squats', riskLevel: 'low', movementPattern: 'squat', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'] },
    { id: 'e2', key: 'glute_bridge', name: 'glute_bridge', riskLevel: 'low', movementPattern: 'hinge', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'] },
    { id: 'e3', key: 'push_ups', name: 'push_ups', riskLevel: 'low', movementPattern: 'push', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'] },
    { id: 'e4', key: 'dead_bug', name: 'dead_bug', riskLevel: 'low', movementPattern: 'core', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'] },
    { id: 'e5', key: 'morning_walk', name: 'morning_walk', riskLevel: 'low', movementPattern: 'cardio', difficulty: 'BEGINNER', equipmentCodes: ['NONE'] },
    { id: 'e6', key: 'stretching', name: 'stretching', riskLevel: 'low', movementPattern: 'mobility', difficulty: 'BEGINNER', equipmentCodes: ['NONE'] },
    { id: 'e7', key: 'core_plank', name: 'core_plank', riskLevel: 'low', movementPattern: 'core', difficulty: 'BEGINNER', equipmentCodes: ['BODYWEIGHT'] },
  ];

  async save(userId: string, version: number, plan: { days: { dayIndex: number; exercises: { name: string; riskLevel: string }[] }[] }) {
    const detail: WorkoutPlanDetail = {
      days: plan.days.map((day) => ({
        dayIndex: day.dayIndex,
        isRestDay: false,
        exercises: day.exercises.map((ex, order) => ({
          exerciseOrder: order,
          exerciseName: ex.name,
          riskLevel: ex.riskLevel as 'low' | 'medium' | 'high',
        })),
      })),
    };
    return this.savePlan(userId, version, detail, { algorithmVersion: 'legacy', inputSnapshotJson: null });
  }

  async savePlan(userId: string, version: number, plan: WorkoutPlanDetail, meta: WorkoutPlanSaveMeta) {
    const list = this.plans.get(userId) ?? [];
    if (list.some((p) => p.version === version)) {
      const err = Object.assign(new Error('duplicate key'), { code: '23505' });
      throw err;
    }
    const row = {
      id: `mem-${userId}-${version}`,
      version,
      status: meta.status ?? 'active',
      algorithmVersion: meta.algorithmVersion,
      plan,
    };
    list.push(row);
    this.plans.set(userId, list);
    return { id: row.id, version };
  }

  async findLatestByUserId(userId: string) {
    const list = this.plans.get(userId) ?? [];
    if (!list.length) return null;
    return [...list].sort((a, b) => b.version - a.version)[0]!;
  }

  async listActiveExercises() {
    return this.catalog;
  }

  async nextVersion(userId: string) {
    const list = this.plans.get(userId) ?? [];
    return list.reduce((max, p) => Math.max(max, p.version), 0) + 1;
  }
}

class MemoryCatalogReleaseService {
  constructor(private readonly repo: MemoryWorkoutRepository) {}

  async listGeneratorEligibleExercises() {
    return {
      release: {
        id: 'rel-bootstrap',
        code: 'workout-catalog-bootstrap-01a',
        status: 'PUBLISHED',
        manifestVersion: 'workout-catalog-manifest-01a.1',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      exercises: await this.repo.listActiveExercises(),
    };
  }
}

class MemoryProfileService {
  profile = {
    trainingLevel: 'BEGINNER' as const,
    workoutsPerWeek: 3,
    equipmentCodes: [] as string[],
    availableEquipment: null as string[] | null,
  };
  goal = { kind: 'lose_weight', target: 70, unit: 'kg' };

  async getProfile() {
    return this.profile;
  }
  async getGoal() {
    return this.goal;
  }
}

class MemoryWorkoutProfileRepository {
  profiles = new Map<string, WorkoutProfile>();
  overrides: Array<WorkoutPlanDayOverride & { workoutPlanId: string }> = [];

  async findByUserId(userId: string) {
    return this.profiles.get(userId) ?? null;
  }
  async createDefaults(userId: string, seed: Pick<WorkoutProfile, 'trainingLevel' | 'workoutsPerWeek'>) {
    const profile: WorkoutProfile = {
      userId,
      ...seed,
      trainingPlace: 'HOME',
      preferredDuration: 'STANDARD',
      availableDays: [0, 2, 4],
      workoutEquipment: ['NONE', 'BODYWEIGHT'],
      preferredActivityTypes: ['strength', 'walking', 'mobility'],
      excludedExerciseKeys: [],
    };
    this.profiles.set(userId, profile);
    return profile;
  }
  async update(userId: string, patch: WorkoutProfilePatch) {
    const profile = { ...this.profiles.get(userId)!, ...patch };
    this.profiles.set(userId, profile);
    return profile;
  }
  async listActiveOverrides(planId: string) {
    return this.overrides.filter((item) => item.workoutPlanId === planId && item.status === 'active');
  }
  async findActiveOverride(planId: string, dayIndex: number) {
    return this.overrides.find((item) =>
      item.workoutPlanId === planId && item.dayIndex === dayIndex && item.status === 'active',
    ) ?? null;
  }
  async replaceActiveOverride(input: {
    userId: string;
    workoutPlanId: string;
    dayIndex: number;
    replacementType: WorkoutReplacementType;
    replacementDayTitle: string | null;
    replacementSnapshot: WorkoutPlanDayDetail;
    moveTargetDayIndex?: number | null;
    reason?: string | null;
  }) {
    for (const item of this.overrides) {
      if (item.workoutPlanId === input.workoutPlanId && item.dayIndex === input.dayIndex) {
        item.status = 'reverted';
        item.revertedAt = new Date();
      }
    }
    const row: WorkoutPlanDayOverride & { workoutPlanId: string } = {
      id: `override-${this.overrides.length + 1}`,
      userId: input.userId,
      workoutPlanId: input.workoutPlanId,
      dayIndex: input.dayIndex,
      replacementType: input.replacementType,
      replacementDayTitle: input.replacementDayTitle,
      replacementSnapshot: input.replacementSnapshot,
      moveTargetDayIndex: input.moveTargetDayIndex ?? null,
      reason: input.reason ?? null,
      source: 'user',
      status: 'active',
      createdAt: new Date(),
      revertedAt: null,
    };
    this.overrides.push(row);
    return row;
  }
  async revert(userId: string, id: string) {
    const item = this.overrides.find((row) => row.id === id && row.userId === userId);
    if (!item) return null;
    item.status = 'reverted';
    item.revertedAt = new Date();
    return item;
  }
}

function service(
  repo = new MemoryWorkoutRepository(),
  profile = new MemoryProfileService(),
  workoutProfiles?: MemoryWorkoutProfileRepository,
) {
  const catalog = new MemoryCatalogReleaseService(repo);
  return new WorkoutEngineService(
    repo as never,
    profile as never,
    undefined,
    workoutProfiles as never,
    catalog as never,
  );
}

describe('WorkoutEngineService', () => {
  it('exercise safety tags are normalized', () => {
    expect(service().register({ name: 'Walk', riskLevel: 'low', safetyTags: ['knee', 'knee'] }).safetyTags).toEqual([
      'knee',
    ]);
  });

  it('workout builder excludes unsafe exercises', () => {
    expect(
      service().build(
        [
          { name: 'Walk', riskLevel: 'low', safetyTags: ['knee'] },
          { name: 'Stretch', riskLevel: 'low' },
        ],
        ['knee'],
      ).days.length,
    ).toBe(1);
  });

  it('getSummary does not auto-create a plan', async () => {
    const summary = await service().getSummary('workout-user');
    expect(summary.version).toBe(0);
    expect(summary.days.length).toBe(0);
    expect(summary.userId).toBe('workout-user');
  });

  it('getActivePlan returns null when empty', async () => {
    const active = await service().getActivePlan('empty-user');
    expect(active).toBe(null);
  });

  it('generatePlan persists next version with algorithm metadata', async () => {
    const repo = new MemoryWorkoutRepository();
    const profile = new MemoryProfileService();
    const svc = service(repo, profile);
    const first = await svc.generatePlan('gen-user');
    expect(first.days.length > 0).toBeTruthy();
    expect(first.version).toBe(1);
    expect(first.algorithmVersion).toBe(ALGORITHM_VERSION);

    const second = await svc.generatePlan('gen-user', { excludedKeys: ['push_ups'] });
    expect(second.version).toBe(2);
    const latest = await repo.findLatestByUserId('gen-user');
    expect(latest?.version).toBe(2);
    expect((await repo.findLatestByUserId('gen-user'))?.algorithmVersion).toBe(ALGORITHM_VERSION);
  });

  it('generatePlan rejects incomplete setup', async () => {
    const profile = new MemoryProfileService();
    profile.goal = null as never;
    await expect(service(new MemoryWorkoutRepository(), profile).generatePlan('u')).rejects.toThrow(
      /WORKOUT_SETUP_INCOMPLETE/,
    );
  });

  it('generatePlan returns a typed no-viable result instead of manufacturing a plan', async () => {
    const result = await service().generatePlan('no-viable-user', {
      excludedKeys: ['bodyweight_squats', 'glute_bridge', 'push_ups', 'dead_bug', 'morning_walk', 'stretching', 'core_plank'],
    });
    expect(result.status).toBe('NO_VIABLE_CANDIDATE');
    if (result.status !== 'NO_VIABLE_CANDIDATE') throw new Error('expected typed no-viable result');
    expect(result.plan).toBeNull();
    expect(result.trace.reasonCodes).toEqual(['NO_ELIGIBLE_EXERCISES']);
  });

  it('getSetupStatus reports missing fields', async () => {
    const profile = new MemoryProfileService();
    profile.goal = null as never;
    profile.profile.workoutsPerWeek = null as never;
    const status = await service(new MemoryWorkoutRepository(), profile).getSetupStatus('u');
    expect(status.ready).toBe(false);
    expect(status.missing.includes('goalKind')).toBeTruthy();
    expect(status.workoutsPerWeek).toBe(3);
  });

  it('generate failure after first plan keeps previous version readable', async () => {
    const repo = new MemoryWorkoutRepository();
    const profile = new MemoryProfileService();
    const svc = service(repo, profile);
    const first = await svc.generatePlan('keep-user');
    expect(first.version).toBe(1);

    const originalSave = repo.savePlan.bind(repo);
    repo.savePlan = async () => {
      throw new Error('WORKOUT_PLAN_GENERATE_FAILED');
    };
    await expect(svc.generatePlan('keep-user')).rejects.toThrow(/WORKOUT_PLAN_GENERATE_FAILED/);
    repo.savePlan = originalSave;

    const latest = await repo.findLatestByUserId('keep-user');
    expect(latest?.version).toBe(1);
    expect(latest?.status).toBe('active');
  });

  it('profile seed copies level and frequency but never kitchen equipment', async () => {
    const profiles = new MemoryWorkoutProfileRepository();
    const profile = new MemoryProfileService();
    profile.profile.availableEquipment = ['OVEN', 'BLENDER'];
    const created = await service(new MemoryWorkoutRepository(), profile, profiles)
      .getOrCreateWorkoutProfile('profile-user');
    expect(created.workoutEquipment).toEqual(['NONE', 'BODYWEIGHT']);
    expect(created.trainingLevel).toBe('BEGINNER');
    expect(created.workoutsPerWeek).toBe(3);
  });

  it('replacement apply is idempotent and revert is idempotent', async () => {
    const repo = new MemoryWorkoutRepository();
    const profiles = new MemoryWorkoutProfileRepository();
    const svc = service(repo, new MemoryProfileService(), profiles);
    await svc.generatePlan('replace-user');
    const first = await svc.applyReplacement('replace-user', {
      dayIndex: 0,
      replacementType: 'WALK',
    });
    const second = await svc.applyReplacement('replace-user', {
      dayIndex: 0,
      replacementType: 'WALK',
    });
    expect(first.id).toBe(second.id);
    const reverted = await svc.revertReplacement('replace-user', first.id);
    const again = await svc.revertReplacement('replace-user', first.id);
    expect(reverted.id).toBe(again.id);
    expect(again.status).toBe('reverted');
  });

  it('profiles remain isolated by user', async () => {
    const profiles = new MemoryWorkoutProfileRepository();
    const svc = service(new MemoryWorkoutRepository(), new MemoryProfileService(), profiles);
    await svc.getOrCreateWorkoutProfile('user-a');
    await svc.getOrCreateWorkoutProfile('user-b');
    await svc.updateWorkoutProfile('user-a', { workoutsPerWeek: 5 });
    expect((await profiles.findByUserId('user-a'))?.workoutsPerWeek).toBe(5);
    expect((await profiles.findByUserId('user-b'))?.workoutsPerWeek).toBe(3);
  });

  it('MOVE_DAY rejects self-target and occupied strength day', async () => {
    const repo = new MemoryWorkoutRepository();
    const profiles = new MemoryWorkoutProfileRepository();
    const svc = service(repo, new MemoryProfileService(), profiles);
    await svc.generatePlan('move-user');
    await expect(
      svc.applyReplacement('move-user', {
        dayIndex: 0,
        replacementType: 'MOVE_DAY',
        moveTargetDayIndex: 0,
      }),
    ).rejects.toThrow(/WORKOUT_MOVE_TARGET_INVALID/);
    // Default 3-day schedule uses Mon/Wed/Fri (0/2/4) — moving Mon onto Wed must conflict.
    await expect(
      svc.applyReplacement('move-user', {
        dayIndex: 0,
        replacementType: 'MOVE_DAY',
        moveTargetDayIndex: 2,
      }),
    ).rejects.toThrow(/WORKOUT_MOVE_TARGET_OCCUPIED/);
    // Adjacent +1 still illegal after excluding source (Tue neighbors Wed).
    await expect(
      svc.applyReplacement('move-user', {
        dayIndex: 0,
        replacementType: 'MOVE_DAY',
        moveTargetDayIndex: 1,
      }),
    ).rejects.toThrow(/WORKOUT_MOVE_HEAVY_ADJACENT/);
  });

  it('MOVE_DAY allows a legal free day and lists that target', async () => {
    const repo = new MemoryWorkoutRepository();
    const profiles = new MemoryWorkoutProfileRepository();
    const svc = service(repo, new MemoryProfileService(), profiles);
    await svc.generatePlan('move-ok-user');

    const options = await svc.listReplacementOptions('move-ok-user', 4);
    const move = options.find((item) => item.type === 'MOVE_DAY');
    expect(move).toBeTruthy();
    expect(move!.moveTargetDayIndex).toBe(5);

    const applied = await svc.applyReplacement('move-ok-user', {
      dayIndex: 4,
      replacementType: 'MOVE_DAY',
      moveTargetDayIndex: move!.moveTargetDayIndex,
    });
    expect(applied.moveTargetDayIndex).toBe(5);
    expect(applied.status).toBe('active');

    const week = await svc.getWeekView('move-ok-user');
    const friday = week.days.find((day) => day.dayIndex === 4);
    const saturday = week.days.find((day) => day.dayIndex === 5);
    expect(friday?.isRestDay).toBe(true);
    expect((saturday?.exercises.length ?? 0) > 0).toBeTruthy();
  });
});
