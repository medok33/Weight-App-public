import { normalizeFoodText } from './recipe-research.policy';

export type ProductSelectionState =
  | 'EXACT_PRODUCT_ALREADY_RESOLVED'
  | 'EXPLICIT_FORM_PRODUCT_SELECTED'
  | 'SINGLE_COMPATIBLE_PRODUCT_SELECTED'
  | 'CANONICAL_FAMILY_DEFAULT_SELECTED'
  | 'PRODUCT_SELECTION_PENDING'
  | 'PRODUCT_CATALOG_GAP'
  | 'PRODUCT_NUTRITION_MISSING'
  | 'PRODUCT_CONFLICT'
  | 'PROCESS_INPUT_ACCOUNTED'
  | 'NOT_APPLICABLE';

export type SelectionProduct = {
  productId: string;
  canonicalName: string;
  form?: string | null;
  fatPercent?: number | null;
  nutritionVersionPresent: boolean;
};

export type SelectionInput = {
  name: string;
  identity: string | null;
  family: string | null;
  productId?: string | null;
  role?: string | null;
  quantity?: number | null;
  unit?: string | null;
};

export type ProductSelectionDecision = {
  state: ProductSelectionState;
  selectedProductId: string | null;
  candidateProductCount: number;
  candidateProductIds: string[];
  explicitQualifiers: string[];
  reason: string;
  nutritionVersionPresent: boolean;
  arbitrarySelection: false;
  priceUsed: false;
  postInputTechniqueRewrite: false;
};

const PROCESS_ONLY = new Set(['вода']);
const FORM_MARKERS = new Set(['сырой', 'сырая', 'сырое', 'свежий', 'свежая', 'свежие', 'замороженный', 'замороженная', 'замороженное', 'консервированный', 'консервированная', 'вареный', 'вареная', 'вареное', 'вареные', 'отварной', 'отварная', 'отварное', 'жареный', 'жареная', 'запеченный', 'запеченная', 'сухой', 'сухая', 'сухое']);

function norm(value: string): string { return normalizeFoodText(value).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(); }
function familyKey(value: string | null): string { return norm(String(value ?? '')).replace(/^family:/, ''); }
function tokens(value: string): string[] { return norm(value).split(' ').filter((token) => token.length > 2 && !/^\d+(?:[.,]\d+)?%$/.test(token)); }
function qualifierTokens(value: string): string[] { return norm(value).split(' ').filter((token) => FORM_MARKERS.has(token) || /^\d+(?:[.,]\d+)?%$/.test(token)); }

function familyMatches(family: string, product: SelectionProduct): boolean {
  const f = familyKey(family);
  const name = norm(product.canonicalName);
  if (!f) return false;
  const aliases: Record<string, string[]> = {
    'растительное масло': ['подсолнечное масло', 'рапсовое масло', 'льняное масло', 'кукурузное масло', 'кокосовое масло', 'оливковое масло'],
    'масло': ['масло'],
    'курица': ['куриная', 'куриное', 'куриный'],
    'говядина': ['говядина', 'говяжий'],
    'свинина': ['свинина', 'свиной'],
    'фарш': ['фарш'],
    'сыр': ['сыр'],
    'перец': ['перец'],
  };
  if (name.includes(f)) return true;
  const needles = aliases[f] ?? [f];
  return needles.some((needle) => name.includes(needle));
}

function compatibleByQualifiers(name: string, product: SelectionProduct): boolean {
  const source = norm(name); const candidate = norm(product.canonicalName);
  const requestedPercent = source.split(' ').filter((token) => token.endsWith('%')).map((v) => Number(v.slice(0, -1).replace(',', '.'))).filter(Number.isFinite);
  if (requestedPercent.length > 0 && !requestedPercent.some((percent) => (product.fatPercent != null && Math.abs(product.fatPercent - percent) < 0.001) || candidate.includes(`${String(percent).replace('.', ',')}%`) || candidate.includes(`${percent}%`))) return false;
  const states: Array<[string, string[]]> = [['заморож', ['заморож']], ['консерв', ['консерв']], ['варен', ['варен', 'отвар']], ['сыр', ['сыр']], ['жарен', ['жарен']], ['запеч', ['запеч']], ['сух', ['сух']]];
  for (const [marker, accepted] of states) if (source.includes(marker) && !accepted.some((value) => candidate.includes(value))) return false;
  if (source.includes('куриная грудка') && !candidate.includes('куриная грудка')) return false;
  if (source.includes('говядина') && source.includes('фарш') && !(candidate.includes('фарш') && candidate.includes('говяж'))) return false;
  if (source.includes('свинина') && source.includes('фарш') && !(candidate.includes('фарш') && candidate.includes('свин'))) return false;
  return true;
}

export function selectCanonicalProduct(input: SelectionInput, catalog: SelectionProduct[]): ProductSelectionDecision {
  const base = (state: ProductSelectionState, reason: string, selectedProductId: string | null, candidates: SelectionProduct[], explicitQualifiers: string[] = []): ProductSelectionDecision => ({ state, selectedProductId, candidateProductCount: candidates.length, candidateProductIds: candidates.map((p) => p.productId).sort(), explicitQualifiers, reason, nutritionVersionPresent: Boolean(selectedProductId && candidates.find((p) => p.productId === selectedProductId)?.nutritionVersionPresent), arbitrarySelection: false, priceUsed: false, postInputTechniqueRewrite: false });
  const source = norm(input.name);
  if (input.role === 'PROCESS_INPUT' || PROCESS_ONLY.has(source)) return base('PROCESS_INPUT_ACCOUNTED', source === 'вода' ? 'explicit non-purchased process medium' : 'process ingredient remains accountable', null, [], qualifierTokens(source));
  if (!source) return base('NOT_APPLICABLE', 'empty ingredient is not selectable', null, []);
  if (input.productId && !input.productId.startsWith('family:')) {
    const selected = catalog.filter((product) => product.productId === input.productId);
    return selected.length === 1 && selected[0]!.nutritionVersionPresent ? base('EXACT_PRODUCT_ALREADY_RESOLVED', 'accepted resolver supplied concrete product with nutrition authority', input.productId, selected, qualifierTokens(source)) : base('PRODUCT_NUTRITION_MISSING', 'resolved product lacks ProductNutritionVersion', input.productId, selected, qualifierTokens(source));
  }
  const family = input.family ?? input.productId ?? input.identity;
  const requestedPercentText = source.split(' ').find((token) => token.endsWith('%')) ?? null;
  const candidates = catalog.filter((product) => ((requestedPercentText && norm(product.canonicalName).includes(requestedPercentText)) || familyMatches(String(family ?? ''), product)) && compatibleByQualifiers(source, product));
  const explicit = qualifierTokens(source);
  if (!candidates.length) return base('PRODUCT_CATALOG_GAP', 'no accepted compatible product remains after explicit evidence', null, [], explicit);
  if (candidates.length === 1) {
    const product = candidates[0]!;
    if (!product.nutritionVersionPresent) return base('PRODUCT_NUTRITION_MISSING', 'single compatible product has no ProductNutritionVersion', null, candidates, explicit);
    const genericMeat = ['говядина', 'свинина', 'курица', 'мясо'].includes(familyKey(String(family ?? '')));
    const explicitMeatCut = /грудк|бедр|крыл|вырезк|лопатк|голяшк|котлет/.test(source);
    if (genericMeat && explicit.length === 0 && !explicitMeatCut) return base('PRODUCT_SELECTION_PENDING', 'generic meat identity cannot choose an arbitrary cut or processing form', null, candidates, explicit);
    return base(explicit.length ? 'EXPLICIT_FORM_PRODUCT_SELECTED' : 'SINGLE_COMPATIBLE_PRODUCT_SELECTED', explicit.length ? 'one product matches explicit source/form qualifiers' : 'exactly one semantically compatible catalog product', product.productId, candidates, explicit);
  }
  return base('PRODUCT_SELECTION_PENDING', 'multiple semantically valid products remain; no arbitrary variant is selected', null, candidates, explicit);
}

export function selectionStateIsConcrete(state: ProductSelectionState): boolean { return state === 'EXACT_PRODUCT_ALREADY_RESOLVED' || state === 'EXPLICIT_FORM_PRODUCT_SELECTED' || state === 'SINGLE_COMPATIBLE_PRODUCT_SELECTED' || state === 'CANONICAL_FAMILY_DEFAULT_SELECTED'; }

export function productIdentityTokens(value: string): string[] { return tokens(value); }
