export type BiologicalSex = 'female' | 'male';
export type NutritionProfile = { sex: BiologicalSex; weightKg: number; heightCm: number; ageYears: number; activityFactor: number };
export type NutritionResult = { bmrKcal: number; tdeeKcal: number; policyVersion: string };
export type DeficitMode = 'conservative' | 'standard' | 'aggressive';
export type CalculationExplanation = { label: string; value: number | string; rationale: string }[];
