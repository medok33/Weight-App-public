import { Injectable } from '@nestjs/common';
import type { MealPlan, OutboxEvent } from '../domain/meal-plan.types';

@Injectable()
export class InMemoryMealPlanRepository {
  private readonly plans: MealPlan[] = [];
  private readonly events: OutboxEvent[] = [];

  save(plan: MealPlan) {
    this.plans.push(Object.freeze(plan));
    return plan;
  }

  all(userId: string) {
    return this.plans.filter((plan) => plan.userId === userId);
  }

  findLatestByUserId(userId: string) {
    const plans = this.all(userId);
    return plans.sort((a, b) => b.version - a.version)[0] ?? null;
  }

  findByIdempotencyKey(key: string) {
    return this.events.find((event) => event.idempotencyKey === key);
  }

  addEvent(event: OutboxEvent) {
    this.events.push(Object.freeze(event));
    return event;
  }
}
