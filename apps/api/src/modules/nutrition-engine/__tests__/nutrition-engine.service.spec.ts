import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calculateBmr, calculateTdee, calorieTarget, proteinTarget, targetEtaWeeks, explainCalculation } from '../domain/nutrition-engine.policy';
test('Mifflin-St Jeor BMR golden fixture', () => assert.equal(calculateBmr({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30 }), 1780));
test('TDEE uses bounded activity factor', () => assert.equal(calculateTdee({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30, activityFactor: 1.5 }).tdeeKcal, 2670));
test('invalid activity factor is rejected', () => assert.throws(() => calculateTdee({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30, activityFactor: 3 }), /NUTRITION_INVALID_ACTIVITY_FACTOR/));
test('deficit respects sex-specific calorie floor', () => assert.equal(calorieTarget(1600, 'aggressive', 'female'), 1280));
test('protein uses reference weight and activity', () => assert.equal(proteinTarget(70, 1.7), 112));
test('ETA is rounded up and explanation is explicit', () => { assert.equal(targetEtaWeeks(80, 70, 0.6), 17); assert.equal(explainCalculation({ bmrKcal: 1700, tdeeKcal: 2400, policyVersion: 'x' }, 2040).length, 3); });
