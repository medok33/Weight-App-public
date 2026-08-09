import { Injectable } from '@nestjs/common';
import { hasAdminAuthority } from '../../auth/domain/account-role.policy';
import { freezeReleaseCandidate, triageBetaBlockers } from '../domain/platform.policy';
import type { BetaBlockerItem, ReleaseCandidateInput, ReleaseCandidateRecord } from '../domain/platform.types';

@Injectable()
export class PlatformService {
  private frozen: ReleaseCandidateRecord | null = null;

  assertOwnerOps(role: string) {
    if (!hasAdminAuthority(role)) throw new Error('OWNER_ACCESS_FORBIDDEN');
  }

  triage(role: string, items: BetaBlockerItem[]) {
    this.assertOwnerOps(role);
    return triageBetaBlockers(items);
  }

  /** STEP_172: freeze RC; same version+commit returns existing record (idempotent). */
  freezeRc(role: string, input: Omit<ReleaseCandidateInput, 'frozenBy'> & { frozenBy: string }) {
    this.assertOwnerOps(role);
    const next = freezeReleaseCandidate(input);
    if (
      this.frozen &&
      this.frozen.version === next.version &&
      this.frozen.commitSha === next.commitSha
    ) {
      return { record: this.frozen, duplicate: true };
    }
    this.frozen = next;
    return { record: next, duplicate: false };
  }

  currentRc(role: string) {
    this.assertOwnerOps(role);
    return this.frozen;
  }
}
