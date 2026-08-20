import { normalizeFoodText } from './recipe-research.policy';

export type IngredientResolutionState =
  | 'EXACT_PRODUCT'
  | 'SAFE_ALIAS'
  | 'PRODUCT_FAMILY_RESOLVED'
  | 'FORM_EXPLICIT_PRODUCT'
  | 'PROCESS_INPUT'
  | 'AMBIGUOUS'
  | 'PRODUCT_MISSING'
  | 'UNRESOLVED'
  | 'COMPOUND_INGREDIENT_LINE'
  | 'ALTERNATIVE_INGREDIENT_LINE'
  | 'SOURCE_SECTION_LABEL'
  | 'SOURCE_ARTIFACT'
  | 'NON_INGREDIENT_TEXT'
  | 'PARSE_NOISE';

export type IngredientIdentityCandidate = {
  productId: string;
  canonicalName: string;
  normalizedName?: string;
  aliases?: string[];
};

export type IngredientFormResolutionOptions = { knownFamilies?: string[] };

export type IngredientResolution = {
  state: IngredientResolutionState;
  normalizedIngredient: string;
  ingredientIdentity: string | null;
  candidateFamily: string | null;
  productId: string | null;
  productSelectionPending: boolean;
  compoundParts: string[];
  alternativeParts: string[];
  formQualifiers: string[];
  accountingRequired: boolean;
  sourceTextKind: 'INGREDIENT' | 'PROCESS_INPUT' | 'SECTION_LABEL' | 'SOURCE_ARTIFACT' | 'PARSE_NOISE';
  reason: string;
};

const FORM_WORDS = new Set([
  'вареный', 'вареная', 'вареное', 'вареные', 'тушеный', 'тушеная', 'тушеное', 'тушеные',
  'жареный', 'жареная', 'жареное', 'жареные', 'запеченный', 'запеченная', 'запеченное',
  'свежий', 'свежая', 'свежие', 'сырой', 'сырая', 'сырое', 'сухой', 'сухая', 'сухое',
  'сушеный', 'сушеная', 'сушеное', 'сушеные',
  'замороженный', 'замороженная', 'замороженное', 'консервированный', 'консервированная',
  'копченый', 'копченая', 'соленый', 'соленая', 'маринованный', 'маринованная',
  'отварной', 'отварная', 'отварное', 'топленый', 'топленая', 'натуральный', 'натуральная',
]);

const PROCESS_MARKERS = new Set(['вода', 'соль', 'перец', 'специи', 'приправа', 'по вкусу']);
const NON_IDENTITY_ADJECTIVES = new Set(['куриный', 'куриная', 'куриное', 'куриные', 'домашний', 'домашняя', 'домашнее', 'молотый', 'молотая', 'молотое', 'молотые']);
const SAFE_WORD_ALIASES: Record<string, string> = {
  'картошка': 'картофель',
  'лук репчатый': 'репчатый лук',
  'масло растительное': 'растительное масло',
  'крупа гречневая': 'гречневая крупа',
  'помидоры': 'помидор',
  'кальмары': 'кальмар',
  'лимонный сок': 'лимонный сок',
  'сок лимона': 'лимонный сок',
};
const STRUCTURAL_PREFIXES = new Set(['стебель', 'корень', 'листья', 'лист', 'белая часть', 'зерна']);

function normalized(value: string): string {
  return normalizeFoodText(value);
}

function morphologyVariants(value: string): string[] {
  const key = normalized(value);
  const variants = new Set([key]);
  const replacements: Array<[RegExp, string]> = [
    [/яйца/g, 'яйцо'], [/помидоры/g, 'помидор'], [/огурцы/g, 'огурец'],
    [/баклажаны/g, 'баклажан'], [/кабачки/g, 'кабачок'], [/яблоки/g, 'яблоко'],
    [/груши/g, 'груша'], [/бананы/g, 'банан'], [/апельсины/g, 'апельсин'],
    [/лимоны/g, 'лимон'], [/персики/g, 'персик'], [/абрикосы/g, 'абрикос'],
    [/сливы/g, 'слива'], [/моркови/g, 'морковь'], [/свеклы/g, 'свекла'],
    [/картофелины/g, 'картофель'], [/грибы/g, 'гриб'], [/кальмары/g, 'кальмар'],
  ];
  for (const [pattern, replacement] of replacements) variants.add(key.replace(pattern, replacement));
  return [...variants];
}

function isFormQualifier(token: string): boolean {
  return FORM_WORDS.has(token) || /^\d+(?:[.,]\d+)?%$/.test(token);
}

function deterministicParts(value: string, separator: RegExp): string[] {
  return value.split(separator).map((part) => normalized(part)).filter(Boolean);
}

function identityFromName(value: string): string {
  const source = normalized(value);
  const aliased = SAFE_WORD_ALIASES[source] ?? source;
  const tokens = aliased.split(' ').filter(Boolean).filter((token) => !isFormQualifier(token) && !NON_IDENTITY_ADJECTIVES.has(token) && !/^\d+(?:[.,]\d+)?$/.test(token));
  return tokens.join(' ').trim();
}

function formQualifiers(value: string): string[] {
  return normalized(value).split(' ').filter((token) => isFormQualifier(token) || ['кокосовый', 'кокосовое', 'растительный', 'растительные'].includes(token));
}

function canonicalNameKey(value: string): string {
  const source = normalized(value);
  const aliased = SAFE_WORD_ALIASES[source] ?? source;
  return morphologyVariants(aliased)[0] ?? aliased;
}

function resultBase(
  state: IngredientResolutionState,
  normalizedIngredient: string,
  fields: Partial<IngredientResolution> = {},
): IngredientResolution {
  return {
    state,
    normalizedIngredient,
    ingredientIdentity: null,
    candidateFamily: null,
    productId: null,
    productSelectionPending: false,
    compoundParts: [],
    alternativeParts: [],
    formQualifiers: [],
    accountingRequired: true,
    sourceTextKind: 'INGREDIENT',
    reason: '',
    ...fields,
  };
}

function exactMatch(value: string, candidates: IngredientIdentityCandidate[]): IngredientIdentityCandidate[] {
  const keys = [...new Set(morphologyVariants(value).map((key) => canonicalNameKey(key)))];
  return candidates.filter((candidate) => {
    const names = [candidate.canonicalName, candidate.normalizedName ?? '', ...(candidate.aliases ?? [])].flatMap((name) => morphologyVariants(name).map((key) => canonicalNameKey(key)));
    return keys.some((key) => names.includes(key));
  });
}

function familyMatches(value: string, candidates: IngredientIdentityCandidate[]): IngredientIdentityCandidate[] {
  const identity = identityFromName(value);
  if (!identity || identity.length < 4) return [];
  const requestedForms = formQualifiers(value);
  return candidates.filter((candidate) => {
    const candidateIdentity = identityFromName(candidate.canonicalName);
    if (candidateIdentity !== identity) return false;
    const candidateForms = formQualifiers(candidate.canonicalName);
    return requestedForms.every((form) => candidateForms.length === 0 || candidateForms.includes(form)) || requestedForms.length === 0;
  });
}

export function resolveIngredientForm(
  input: { name: string; classification?: string | null },
  candidates: IngredientIdentityCandidate[],
  options: IngredientFormResolutionOptions = {},
): IngredientResolution {
  const source = String(input.name ?? '').trim();
  const normalizedIngredient = normalized(source);
  const classification = String(input.classification ?? '').toUpperCase();
  const withoutTaste = normalizedIngredient.replace(/\s*,?\s*по вкусу\s*$/i, '').trim();

  if (!source || source === 'или' || source === 'либо') {
    return resultBase('PARSE_NOISE', normalizedIngredient, { sourceTextKind: 'PARSE_NOISE', reason: 'empty or orphaned alternative marker' });
  }
  if (/^для\s+/i.test(source)) {
    return resultBase('SOURCE_SECTION_LABEL', normalizedIngredient, { sourceTextKind: 'SECTION_LABEL', reason: 'recipe section label is not an ingredient' });
  }
  if (/\s+(?:или|либо)\s+/i.test(source)) {
    const alternativeParts = deterministicParts(source, /\s+(?:или|либо)\s+/i);
    return resultBase('ALTERNATIVE_INGREDIENT_LINE', normalizedIngredient, { productSelectionPending: true, alternativeParts, reason: 'deterministic alternative grammar' });
  }
  if (/,/.test(source)) {
    const compoundParts = deterministicParts(source.replace(/\s*,?\s*по вкусу\s*$/i, ''), /[,;]/);
    if (compoundParts.length >= 2) return resultBase('COMPOUND_INGREDIENT_LINE', normalizedIngredient, { productSelectionPending: true, compoundParts, reason: 'deterministic comma-separated compound' });
  }
  if (classification === 'PROCESS_INPUT' || PROCESS_MARKERS.has(withoutTaste)) {
    const accountingRequired = withoutTaste !== 'вода';
    return resultBase('PROCESS_INPUT', normalizedIngredient, { ingredientIdentity: identityFromName(withoutTaste) || withoutTaste, candidateFamily: identityFromName(withoutTaste) || withoutTaste, accountingRequired, sourceTextKind: 'PROCESS_INPUT', reason: accountingRequired ? 'process ingredient remains in accounting' : 'non-purchased process medium' });
  }

  const exact = exactMatch(withoutTaste, candidates);
  if (exact.length === 1) {
    const candidate = exact[0]!;
    const explicitForm = normalized(candidate.canonicalName) !== identityFromName(withoutTaste);
    const safeAlias = canonicalNameKey(withoutTaste) !== normalized(withoutTaste) || ![candidate.canonicalName, candidate.normalizedName ?? '', ...(candidate.aliases ?? [])].some((name) => normalized(name) === normalized(withoutTaste));
    return resultBase(explicitForm ? 'FORM_EXPLICIT_PRODUCT' : safeAlias ? 'SAFE_ALIAS' : 'EXACT_PRODUCT', normalizedIngredient, { ingredientIdentity: identityFromName(withoutTaste), candidateFamily: identityFromName(candidate.canonicalName), productId: candidate.productId, formQualifiers: formQualifiers(withoutTaste), reason: explicitForm ? 'exact accepted form-specific product' : safeAlias ? 'deterministic lexical alias' : 'exact canonical product' });
  }
  if (exact.length > 1) return resultBase('AMBIGUOUS', normalizedIngredient, { ingredientIdentity: identityFromName(withoutTaste), candidateFamily: identityFromName(withoutTaste), productSelectionPending: true, formQualifiers: formQualifiers(withoutTaste), reason: 'multiple accepted products match exact wording' });

  const family = familyMatches(withoutTaste, candidates);
  const requestedIdentity = identityFromName(withoutTaste);
  const exactFamily = family.filter((candidate) => identityFromName(candidate.canonicalName) === requestedIdentity);
  if (exactFamily.length > 0) {
    return resultBase('PRODUCT_FAMILY_RESOLVED', normalizedIngredient, { ingredientIdentity: requestedIdentity, candidateFamily: requestedIdentity, productSelectionPending: true, formQualifiers: formQualifiers(withoutTaste), reason: 'generic identity resolved without arbitrary variant selection' });
  }
  const familyNames = [...new Set(family.map((candidate) => identityFromName(candidate.canonicalName)).filter(Boolean))];
  const knownFamilies = (options.knownFamilies ?? []).map(identityFromName).filter((value) => value.length >= 4);
  const knownFamily = knownFamilies.find((value) => requestedIdentity === value || [...STRUCTURAL_PREFIXES].some((prefix) => requestedIdentity === `${prefix} ${value}`));
  if (knownFamily) {
    return resultBase('PRODUCT_FAMILY_RESOLVED', normalizedIngredient, { ingredientIdentity: requestedIdentity, candidateFamily: knownFamily, productSelectionPending: true, formQualifiers: formQualifiers(withoutTaste), reason: 'corpus-backed identity family; concrete product selection remains pending' });
  }
  if (familyNames.length === 1) {
    return resultBase('PRODUCT_FAMILY_RESOLVED', normalizedIngredient, { ingredientIdentity: identityFromName(withoutTaste), candidateFamily: familyNames[0]!, productSelectionPending: true, formQualifiers: formQualifiers(withoutTaste), reason: 'generic identity resolved without arbitrary variant selection' });
  }
  if (familyNames.length > 1) return resultBase('AMBIGUOUS', normalizedIngredient, { ingredientIdentity: identityFromName(withoutTaste), productSelectionPending: true, formQualifiers: formQualifiers(withoutTaste), reason: 'identity maps to incompatible families' });
  return resultBase('PRODUCT_MISSING', normalizedIngredient, { ingredientIdentity: identityFromName(withoutTaste) || null, productSelectionPending: true, formQualifiers: formQualifiers(withoutTaste), reason: 'no accepted product or family evidence' });
}
