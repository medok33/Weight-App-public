export type BetaBlockerSeverity = 'blocker' | 'major' | 'minor';

export type BetaBlockerItem = {
  id: string;
  title: string;
  severity: BetaBlockerSeverity;
  fixed: boolean;
};

export type BetaTriageResult = {
  ready: boolean;
  openBlockers: string[];
  openMajors: string[];
  items: BetaBlockerItem[];
};

/** STEP_172 */
export type ReleaseCandidateInput = {
  version: string;
  changelog: string;
  commitSha: string;
  frozenBy: string;
};

export type ReleaseCandidateRecord = ReleaseCandidateInput & {
  status: 'frozen';
  frozenAt: string;
};
