import { describe, expect, it } from 'vitest';
import { deployRollbackOrder, validateDeployRunbookStep } from '../domain/observability.policy';

describe('observability deploy runbooks STEP_158', () => {
  it('validates migrate/deploy/rollback entries', () => {
    expect(validateDeployRunbookStep({ action: 'migrate', migrationName: '156_observability-deploy-run' }).action).toBe(
      'migrate',
    );
    expect(() => validateDeployRunbookStep({ action: 'drop', migrationName: '156_x' })).toThrow('DEPLOY_RUN_INVALID');
    expect(deployRollbackOrder(['155_a', '156_b', '154_c'])).toEqual(['156_b', '155_a', '154_c']);
  });
});
