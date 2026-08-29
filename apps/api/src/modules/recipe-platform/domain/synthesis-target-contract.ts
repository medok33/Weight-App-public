import type { SynthesisBrief } from './recipe-knowledge-synthesis.policy';

export type SynthesisTargetContract = {
  clusterId: string;
  label: string;
  requiredTerms: string[];
  forbiddenTerms: RegExp;
  maxTotalTimeMinutes: number;
  validateBrief(brief: SynthesisBrief): void;
};

const exactProducts = (brief: SynthesisBrief): Set<string> => new Set(brief.approvedProducts);

function commonBriefChecks(brief: SynthesisBrief, contract: Pick<SynthesisTargetContract, 'clusterId' | 'maxTotalTimeMinutes'>): void {
  if (brief.clusterId !== contract.clusterId) throw new Error('SYNTHESIS_BRIEF_CLUSTER_MISMATCH');
  if (brief.status !== 'APPROVED_FOR_SYNTHESIS' || brief.approvalState !== 'OWNER_APPROVED') throw new Error('SYNTHESIS_BRIEF_NOT_APPROVED');
  if (brief.totalTimeMinutes != null && brief.totalTimeMinutes > contract.maxTotalTimeMinutes) throw new Error('SYNTHESIS_TIME_LIMIT_EXCEEDED');
  if (exactProducts(brief).size === 0) throw new Error('SYNTHESIS_BRIEF_PRODUCTS_REQUIRED');
}

export const CLASSIC_JULIENNE_TARGET: SynthesisTargetContract = {
  clusterId: 'dcluster_8c521f996b1e8844f530ff12', label: 'Classic Julienne',
  requiredTerms: ['курин', 'шампин', 'сметан', 'сыр', 'оливков'], forbiddenTerms: /рис|майонез/i, maxTotalTimeMinutes: 60,
  validateBrief: (brief) => commonBriefChecks(brief, CLASSIC_JULIENNE_TARGET),
};

export const TOMATO_OMELET_TARGET: SynthesisTargetContract = {
  clusterId: 'dcluster_87b96a2fc22b24da2b6baa44', label: 'Tomato Omelet',
  requiredTerms: ['яйц', 'помид'], forbiddenTerms: /сливочн\s+масл|рис/i, maxTotalTimeMinutes: 45,
  validateBrief: (brief) => {
    commonBriefChecks(brief, TOMATO_OMELET_TARGET);
    if (brief.ownerDecisions?.sunflowerOil !== 'sunflower_oil') throw new Error('TOMATO_OIL_POLICY_INVALID');
    if (brief.ownerDecisions?.butterRequired === 'YES') throw new Error('TOMATO_BUTTER_FORBIDDEN');
  },
};

export const RICE_PUMPKIN_PORRIDGE_TARGET: SynthesisTargetContract = {
  clusterId: 'dcluster_06210e70a9392b5421aa0155', label: 'Rice/Pumpkin Porridge',
  requiredTerms: ['рис', 'тыкв'], forbiddenTerms: /цедр|апельсинов.*цедр/i, maxTotalTimeMinutes: 45,
  validateBrief: (brief) => {
    commonBriefChecks(brief, RICE_PUMPKIN_PORRIDGE_TARGET);
    if (brief.ownerDecisions?.orangeZestRequired === 'YES' || brief.ownerDecisions?.orangeZestIncluded === 'YES') throw new Error('RICE_ORANGE_ZEST_FORBIDDEN');
  },
};

export const SYNTHESIS_TARGET_REGISTRY = new Map<string, SynthesisTargetContract>([
  [CLASSIC_JULIENNE_TARGET.clusterId, CLASSIC_JULIENNE_TARGET],
  [TOMATO_OMELET_TARGET.clusterId, TOMATO_OMELET_TARGET],
  [RICE_PUMPKIN_PORRIDGE_TARGET.clusterId, RICE_PUMPKIN_PORRIDGE_TARGET],
]);

export function resolveSynthesisTarget(clusterId: string): SynthesisTargetContract {
  const target = SYNTHESIS_TARGET_REGISTRY.get(clusterId);
  if (!target) throw new Error('SYNTHESIS_TARGET_NOT_REGISTERED');
  return target;
}
