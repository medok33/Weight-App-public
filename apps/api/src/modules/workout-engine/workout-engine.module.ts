import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ProgressModule } from '../progress/progress.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { WorkoutCatalogReleaseService } from './catalog/workout-catalog-release.service';
import { createExerciseMediaGeneratorFromEnv } from './catalog/disabled-exercise-media.generator';
import type { ExerciseMediaGenerator } from './catalog/exercise-media.generator';
import { WorkoutEngineController } from './controllers/workout-engine.controller';
import { WorkoutCatalogAdminController } from './controllers/workout-catalog-admin.controller';
import { WorkoutEngineService } from './application/workout-engine.service';
import { WorkoutSessionService } from './application/workout-session.service';
import { WorkoutAdaptationService } from './application/workout-adaptation.service';
import { ExerciseMediaService } from './application/exercise-media.service';
import { WorkoutEngineRepository } from './infrastructure/workout-engine.repository';
import { WorkoutProfileRepository } from './infrastructure/workout-profile.repository';
import { WorkoutSessionRepository } from './infrastructure/workout-session.repository';
import { WorkoutAdaptationRepository } from './infrastructure/workout-adaptation.repository';
import { ExerciseEnergyProfileRepository } from './energy/exercise-energy-profile.repository';
import { ExerciseEnergyTimingProfileRepository } from './energy/exercise-energy-timing-profile.repository';
import { WorkoutEnergyService } from './energy/workout-energy.service';

export const EXERCISE_MEDIA_GENERATOR = 'EXERCISE_MEDIA_GENERATOR';

@Module({
  imports: [DatabaseModule, UserProfileModule, ProgressModule],
  controllers: [WorkoutEngineController, WorkoutCatalogAdminController],
  providers: [
    WorkoutEngineService,
    WorkoutSessionService,
    WorkoutAdaptationService,
    ExerciseMediaService,
    WorkoutEngineRepository,
    WorkoutProfileRepository,
    WorkoutSessionRepository,
    WorkoutAdaptationRepository,
    WorkoutCatalogReleaseService,
    ExerciseEnergyProfileRepository,
    ExerciseEnergyTimingProfileRepository,
    WorkoutEnergyService,
    {
      provide: EXERCISE_MEDIA_GENERATOR,
      useFactory: (): ExerciseMediaGenerator => createExerciseMediaGeneratorFromEnv(),
    },
  ],
  exports: [
    WorkoutEngineService,
    WorkoutSessionService,
    WorkoutCatalogReleaseService,
    ExerciseMediaService,
    WorkoutEnergyService,
    ExerciseEnergyProfileRepository,
    ExerciseEnergyTimingProfileRepository,
    EXERCISE_MEDIA_GENERATOR,
  ],
})
export class WorkoutEngineModule {}
