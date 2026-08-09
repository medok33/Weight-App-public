import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UserProfileRepository } from '../../src/modules/user-profile/infrastructure/user-profile.repository';
import { UserProfileService } from '../../src/modules/user-profile/application/user-profile.service';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});
const db = { query: <T>(text: string, values: unknown[] = []) => pool.query<T>(text, values) } as PrismaService;

describe('profile and goal persistence', () => {
  let userId = '';

  beforeAll(async () => {
    const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/095_user-profile-fields/migration.sql'), 'utf8');
    await pool.query(migration);
    const migration199 = resolve(process.cwd(), 'prisma/migrations/199_price-dataclass-profile-structure/migration.sql');
    try {
      await pool.query(readFileSync(migration199, 'utf8'));
    } catch {
      // migration may already be applied in shared DB
    }
    const repository = new UserProfileRepository(db);
    userId = await repository.createUser();
  });

  afterAll(async () => {
    if (userId) {
      await pool.query('DELETE FROM "UserGoal" WHERE "profileId" IN (SELECT id FROM "UserProfile" WHERE "userId" = $1)', [userId]);
      await pool.query('DELETE FROM "UserProfile" WHERE "userId" = $1', [userId]);
      await pool.query('DELETE FROM "User" WHERE id = $1', [userId]);
    }
    await pool.end();
  });

  it('saves profile and goal then reloads them', async () => {
    const repository = new UserProfileRepository(db);
    const savedProfile = await repository.upsertProfile(userId, {
      displayName: 'MVP User',
      ageYears: 32,
      heightCm: 178,
      weightKg: 82,
      activityLevel: 'moderate',
      locale: 'en',
    });
    expect(savedProfile.displayName).toBe('MVP User');
    expect(savedProfile.locale).toBe('en');

    const savedGoal = await repository.upsertGoal(userId, {
      kind: 'lose_weight',
      target: 75,
      unit: 'kg',
    });
    expect(savedGoal.target).toBe(75);

    const reloadedProfile = await repository.getProfile(userId);
    const reloadedGoal = await repository.getGoal(userId);
    expect(reloadedProfile?.weightKg).toBe(82);
    expect(reloadedGoal?.kind).toBe('lose_weight');
  });

  it('GET profile via service returns structured allergen/diet/equipment codes', async () => {
    const repository = new UserProfileRepository(db);
    const service = new UserProfileService(repository);
    await service.upsertProfile(userId, {
      displayName: 'Structured User',
      ageYears: 28,
      heightCm: 170,
      weightKg: 70,
      activityLevel: 'light',
      locale: 'ru',
      allergenCodes: ['gluten'],
      dietaryCodes: ['vegetarian'],
      equipmentCodes: ['BASIC_STOVE'],
      foodRestrictions: ['случайная заметка'],
    });

    const profile = await service.getProfile(userId);
    expect(profile?.allergenCodes).toEqual(expect.arrayContaining(['gluten']));
    expect(profile?.dietaryCodes).toEqual(expect.arrayContaining(['vegetarian']));
    expect(profile?.equipmentCodes).toEqual(expect.arrayContaining(['BASIC_STOVE']));
    expect(profile?.foodRestrictions?.join(' ')).toMatch(/случайная заметка/);
  });
});
