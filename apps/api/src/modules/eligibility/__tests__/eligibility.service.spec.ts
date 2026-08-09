import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EligibilityService } from '../application/eligibility.service';

const answers = { ageBand: '18_64' as const, pregnancy: false, eatingDisorderRisk: false };
test('eligibility happy path is deterministic and persisted', () => assert.equal(new EligibilityService().evaluate('u1', answers).decision.outcome, 'eligible'));
test('minor is blocked without AI', () => assert.equal(new EligibilityService().evaluate('u1', { ...answers, ageBand: 'under_18' }).decision.reasonCode, 'MINOR'));
test('invalid questionnaire is rejected at the boundary', () => assert.throws(() => new EligibilityService().evaluate('u1', { ageBand: '18_64' }), /ELIGIBILITY_INVALID_INPUT/));
