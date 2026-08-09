export class MealPlanGenerateRequestDto {
  userId!: string;
  idempotencyKey!: string;
  recipes?: Array<{ id: string; name: string; calories: number; tags?: string[] }>;
}
