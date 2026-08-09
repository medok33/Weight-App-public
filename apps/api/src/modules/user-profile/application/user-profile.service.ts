import { Inject, Injectable } from '@nestjs/common';
import { validateGoalInput, validateProfileInput } from '../domain/user-profile.policy';
import type { GoalUpsertInput, ProfileUpsertInput } from '../domain/user-profile.types';
import { UserProfileRepository } from '../infrastructure/user-profile.repository';

@Injectable()
export class UserProfileService {
  constructor(@Inject(UserProfileRepository) private readonly repository: UserProfileRepository) {}

  bootstrapUser() {
    return this.repository.createUser();
  }

  async assertUser(userId: string) {
    if (!userId) throw new Error('USER_ID_REQUIRED');
    const exists = await this.repository.userExists(userId);
    if (!exists) throw new Error('USER_NOT_FOUND');
    return userId;
  }

  async getProfile(userId: string) {
    await this.assertUser(userId);
    return this.repository.getProfile(userId);
  }

  async upsertProfile(userId: string, input: ProfileUpsertInput) {
    await this.assertUser(userId);
    return this.repository.upsertProfile(userId, validateProfileInput(input));
  }

  async getGoal(userId: string) {
    await this.assertUser(userId);
    return this.repository.getGoal(userId);
  }

  async upsertGoal(userId: string, input: GoalUpsertInput) {
    await this.assertUser(userId);
    return this.repository.upsertGoal(userId, validateGoalInput(input));
  }
}
