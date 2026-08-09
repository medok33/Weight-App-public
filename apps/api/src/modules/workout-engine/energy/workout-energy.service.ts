import { Inject, Injectable } from '@nestjs/common';
import { ProgressRepository } from '../../progress/infrastructure/progress.repository';
import { UserProfileService } from '../../user-profile/application/user-profile.service';
import {
  estimateExerciseEnergy,
} from './workout-energy.calculator';
import {
  resolveWorkoutEnergyWeight,
  type ResolveWeightResult,
} from './workout-energy-weight.resolver';
import { ExerciseEnergyProfileRepository } from './exercise-energy-profile.repository';
import type {
  EnergyCalculatorInput,
  EnergyEstimateResult,
  ExerciseEnergyProfileRecord,
} from './workout-energy.types';
import {
  ENERGY_PILOT_MAPPINGS,
  ENERGY_PILOT_UNSUPPORTED_EXERCISE_KEYS,
  type EnergyPilotMapping,
} from './pilot/energy-pilot-manifest';

@Injectable()
export class WorkoutEnergyService {
  constructor(
    @Inject(ProgressRepository) private readonly progressRepository: ProgressRepository,
    @Inject(UserProfileService) private readonly userProfileService: UserProfileService,
    @Inject(ExerciseEnergyProfileRepository)
    private readonly energyProfileRepository: ExerciseEnergyProfileRepository,
  ) {}

  estimateExerciseEnergy(input: EnergyCalculatorInput): EnergyEstimateResult {
    return estimateExerciseEnergy(input);
  }

  async resolveWeight(userId: string, asOf: Date = new Date()): Promise<ResolveWeightResult> {
    const entries = await this.progressRepository.listWeightEntriesAsOf(userId, asOf);
    const profile = await this.userProfileService.getProfile(userId).catch(() => null);

    return resolveWorkoutEnergyWeight({
      userId,
      asOf: asOf.toISOString(),
      progressEntries: entries.map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        measuredAt: entry.measuredAt,
        createdAt: entry.createdAt,
        weightKg: entry.weightKg,
      })),
      profile:
        profile && typeof profile.weightKg === 'number'
          ? { userId: profile.userId, weightKg: profile.weightKg }
          : null,
    });
  }

  async resolveApprovedProfile(
    exerciseRevisionId: string,
    policyVersion?: string,
  ): Promise<ExerciseEnergyProfileRecord | null> {
    return this.energyProfileRepository.resolveApproved(exerciseRevisionId, policyVersion);
  }

  listPilotManifest(): readonly EnergyPilotMapping[] {
    return ENERGY_PILOT_MAPPINGS;
  }

  listPilotUnsupportedKeys(): readonly string[] {
    return ENERGY_PILOT_UNSUPPORTED_EXERCISE_KEYS;
  }
}
