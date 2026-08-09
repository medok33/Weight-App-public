'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/locale-provider';
import { COVERAGE_STATUS_KEYS, labelOrEnum } from '../../../i18n/admin-label';
import type { AdminMessageKey } from '../../../i18n/admin-message-keys';

const SEARCH_RECOMMENDATION_RU: Record<string, string> = {
  USE_EXISTING_RECIPE: 'Использовать существующий рецепт',
  ADJUST_PORTION_OF_EXISTING: 'Подходит после изменения порции',
  ADAPT_EXISTING_RECIPE: 'Можно адаптировать существующий рецепт',
  CREATE_FAMILY_VARIANT: 'Нужен отдельный вариант семейства',
  REVIEW_DUPLICATE_CANDIDATES: 'Сначала проверить возможные дубли',
  RESEARCH_REQUIRED: 'Требуется исследование нового рецепта',
  BLOCKED_NO_SAFE_ACTION: 'Безопасное действие пока невозможно',
};

type Slot = {
  id: string;
  slotKey: string;
  matrixVersion: string;
  name: string;
  mealType: string;
  dishType: string;
  cookingMethod: string | null;
  primaryProductId: string | null;
  primaryProductName: string | null;
  calorieMin: number | null;
  calorieMax: number | null;
  desiredRecipeCount: number;
  publishedRecipeCount: number;
  status: string;
  priority: string;
  rationale: string;
};

type Assignment = {
  id: string;
  recipeName: string;
  recipeKey: string | null;
  versionNumber: number;
  assignmentType: string;
  matchStatus: string;
  matchScore: string | number;
};

type AnalysisRun = {
  id: string;
  mode: string;
  status: string;
  dryRun: boolean;
  reason: string;
  inputChecksum: string | null;
  resultChecksum: string | null;
  durationMs: number | null;
  slotCount: number;
  eligibleRecipeCount: number;
  comparisonCount: number;
  createdAt: string;
  errorCode?: string | null;
};

type PortionAdjustment = {
  feasible: boolean;
  multiplier: number | null;
  calories: number | null;
  proteinG: number | null;
  fatG: number | null;
  reason?: string;
};

type AdaptationSummary = {
  mutatesCanonicalRecipeVersion?: boolean;
  previewOnly?: boolean;
  sourceProductId?: string;
  replacementProductId?: string;
  sourceProductName?: string | null;
  replacementProductName?: string | null;
  edgeId?: string;
  curatedLabel?: string;
  cookingMethodCompatible?: boolean;
  ratio?: number;
  adjustedQuantity?: { amount: number; unit: string };
  note?: string;
};

type SearchCandidate = {
  recipeId: string;
  recipeVersionId: string;
  title: string;
  candidateType: string;
  score: number;
  rank: number;
  reasons?: string[];
  nutrition?: { calories: number; proteinG: number; fatG: number; servings: number };
  portionAdjustment?: PortionAdjustment | null;
  adaptationSummary?: AdaptationSummary | null;
  cookingMethods?: string[];
  dietaryCompatibility?: boolean;
  equipmentCompatibility?: boolean;
  costStatus?: string;
  matchedDimensions?: string[];
  failedDimensions?: string[];
  unknownDimensions?: string[];
};

type SearchResult = {
  runId: string;
  recommendation?: string;
  reasons?: string[];
  candidates?: SearchCandidate[];
  resultChecksum?: string;
  inputChecksum?: string;
  exactDuplicateBlockers?: string[];
  expiresAt?: string;
  decisionExpiresAt?: string;
  decisionStale?: boolean;
  status?: string;
};

function formatMacros(n: { calories: number; proteinG: number; fatG: number }): string {
  return `${Math.round(n.calories)} ккал · Б ${n.proteinG.toFixed(1)} · Ж ${n.fatG.toFixed(1)}`;
}

function humanizeCostStatus(status: string | undefined): string {
  switch (status) {
    case 'WITHIN_BUDGET':
      return 'В пределах бюджета';
    case 'OVER_BUDGET':
      return 'Выше бюджета';
    case 'CURRENT_PRICE_CONFIRMED':
      return 'Цена из магазина';
    case 'STALE_PRICE':
      return 'Цена устарела';
    case 'PRICE_INCOMPLETE':
    case 'UNCONFIRMED':
      return 'Цена не подтверждена';
    case 'PRICE_MISSING':
      return 'Цена не найдена';
    case 'PRICE_UNKNOWN':
      return 'Цена неизвестна';
    case 'NOT_APPLICABLE':
      return 'Не применялось';
    default:
      return status?.replace(/_/g, ' ').toLowerCase() ?? '—';
  }
}

function humanizeDimension(code: string): string {
  const map: Record<string, string> = {
    CALORIES: 'калории',
    PROTEIN: 'белок',
    FAT: 'жиры',
    PRODUCT: 'продукт',
    DISH: 'тип блюда',
    COOKING_METHOD: 'способ готовки',
    DIETARY: 'диета',
    EQUIPMENT: 'оборудование',
    TIME: 'время',
    COST: 'стоимость',
  };
  return map[code] ?? code.replace(/_/g, ' ').toLowerCase();
}

function productDisplayName(
  productId: string | undefined,
  slot: Slot,
  role: 'source' | 'replacement',
  summary?: AdaptationSummary,
): string {
  if (role === 'source' && summary?.sourceProductName) return summary.sourceProductName;
  if (role === 'replacement' && summary?.replacementProductName) return summary.replacementProductName;
  if (!productId) return '—';
  if (slot.primaryProductId && productId === slot.primaryProductId && slot.primaryProductName) {
    return slot.primaryProductName;
  }
  if (role === 'source') return 'Продукт в рецепте';
  if (slot.primaryProductName) return slot.primaryProductName;
  return 'Замена по слоту';
}

function pickPortionCandidate(candidates: SearchCandidate[]): SearchCandidate | null {
  const ranked = [...candidates].sort((a, b) => a.rank - b.rank);
  return (
    ranked.find(
      (c) =>
        c.candidateType === 'PORTION_ADJUSTABLE' &&
        c.portionAdjustment?.feasible &&
        c.portionAdjustment.multiplier != null &&
        c.portionAdjustment.multiplier !== 1,
    ) ??
    ranked.find((c) => c.portionAdjustment?.feasible && c.portionAdjustment.multiplier != null) ??
    null
  );
}

function pickAdaptCandidate(candidates: SearchCandidate[]): SearchCandidate | null {
  const ranked = [...candidates].sort((a, b) => a.rank - b.rank);
  return (
    ranked.find((c) => c.candidateType === 'SAFE_SUBSTITUTION_ADAPTABLE' && c.adaptationSummary) ??
    ranked.find((c) => c.adaptationSummary) ??
    null
  );
}

function cookingMethodCompatible(candidate: SearchCandidate): boolean | null {
  if (candidate.failedDimensions?.some((d) => d.includes('METHOD') || d.includes('COOKING'))) {
    return false;
  }
  if (candidate.matchedDimensions?.some((d) => d.includes('METHOD') || d.includes('COOKING'))) {
    return true;
  }
  if ((candidate.cookingMethods?.length ?? 0) > 0) return true;
  return null;
}

const MEAL_KEYS: Record<string, AdminMessageKey> = {
  breakfast: 'admin.coverage.slots.meal.breakfast',
  lunch: 'admin.coverage.slots.meal.lunch',
  dinner: 'admin.coverage.slots.meal.dinner',
  snack: 'admin.coverage.slots.meal.snack',
  afternoon_snack: 'admin.coverage.slots.meal.afternoon_snack',
};

const PRIORITY_KEYS: Record<string, AdminMessageKey> = {
  CRITICAL: 'admin.coverage.slots.priority.CRITICAL',
  HIGH: 'admin.coverage.slots.priority.HIGH',
  MEDIUM: 'admin.coverage.slots.priority.MEDIUM',
  LOW: 'admin.coverage.slots.priority.LOW',
};

export function RecipeCoverageSlotsScreen() {
  const { t } = useI18n();
  const [items, setItems] = useState<Slot[]>([]);
  const [total, setTotal] = useState(0);
  const [mealType, setMealType] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Slot | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [dirty, setDirty] = useState<Record<string, unknown> | null>(null);
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [decisionExpiry, setDecisionExpiry] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'loading' | 'forbidden' | 'error' | 'success'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (mealType) params.set('mealType', mealType);
    if (priority) params.set('priority', priority);
    if (status) params.set('status', status);
    params.set('limit', '100');
    return params.toString();
  }, [mealType, priority, status]);

  async function reloadMeta() {
    const [runsRes, dirtyRes] = await Promise.all([
      fetch('/api/admin/recipe-coverage/runs?limit=10', { cache: 'no-store' }),
      fetch('/api/admin/recipe-coverage/dirty', { cache: 'no-store' }),
    ]);
    if (runsRes.ok) {
      const data = (await runsRes.json()) as { items: AnalysisRun[] };
      setRuns(data.items ?? []);
    }
    if (dirtyRes.ok) {
      const data = (await dirtyRes.json()) as { dirty: Record<string, unknown> | null };
      setDirty(data.dirty);
    }
  }

  async function reload() {
    setState('loading');
    const response = await fetch(`/api/admin/recipe-coverage/slots?${query}`, { cache: 'no-store' });
    if (response.status === 401 || response.status === 403) {
      setState('forbidden');
      return;
    }
    if (!response.ok) {
      setState('error');
      return;
    }
    const data = (await response.json()) as { items: Slot[]; total: number; matrixVersion: string };
    setItems(data.items ?? []);
    setTotal(data.total ?? 0);
    setState('success');
    await reloadMeta();
  }

  useEffect(() => {
    void reload();
  }, [query]);

  useEffect(() => {
    if (state !== 'success') return;
    if (typeof window === 'undefined') return;
    const selectedId = new URLSearchParams(window.location.search).get('selected');
    if (!selectedId) return;
    if (selected?.id === selectedId) return;
    const match = items.find((s) => s.id === selectedId);
    if (match) {
      void openSlot(match);
      return;
    }
    void (async () => {
      const response = await fetch(`/api/admin/recipe-coverage/slots/${selectedId}`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const slot = (await response.json()) as Slot;
      if (slot?.id) await openSlot(slot);
    })();
  }, [state, items, selected?.id]);

  async function restoreLatestSearch(slotId: string) {
    const runsRes = await fetch(
      `/api/admin/recipe-search/runs?coverageSlotId=${encodeURIComponent(slotId)}&limit=1`,
      { cache: 'no-store' },
    );
    if (!runsRes.ok) return;
    const runsData = (await runsRes.json()) as { items?: Array<{ id: string }> };
    const latestId = runsData.items?.[0]?.id;
    if (!latestId) return;

    const [runRes, candidatesRes] = await Promise.all([
      fetch(`/api/admin/recipe-search/runs/${latestId}`, { cache: 'no-store' }),
      fetch(`/api/admin/recipe-search/runs/${latestId}/candidates`, { cache: 'no-store' }),
    ]);
    if (!runRes.ok) return;
    const run = (await runRes.json()) as {
      id: string;
      resultJson?: SearchResult & { recommendation?: string };
      resultChecksum?: string | null;
      inputChecksum?: string | null;
      expiresAt?: string | null;
      decisionStale?: boolean;
      latestDecision?: { expiresAt?: string | null; invalidatedAt?: string | null } | null;
    };
    let candidates: SearchCandidate[] = [];
    if (candidatesRes.ok) {
      const candBody = (await candidatesRes.json()) as {
        items?: SearchCandidate[];
        candidates?: SearchCandidate[];
      };
      candidates = candBody.items ?? candBody.candidates ?? [];
    }
    const fromJson = (run.resultJson ?? {}) as SearchResult;
    const recommendation =
      typeof fromJson.recommendation === 'string' ? fromJson.recommendation : undefined;
    const expiry =
      (run.latestDecision as { expiresAt?: string | null; invalidatedAt?: string | null } | null | undefined)
        ?.expiresAt ??
      run.expiresAt ??
      fromJson.expiresAt ??
      null;
    const invalidatedAt = (
      run.latestDecision as { invalidatedAt?: string | null } | null | undefined
    )?.invalidatedAt;
    const decisionStale = Boolean(
      run.decisionStale ||
        invalidatedAt ||
        (expiry && Date.parse(String(expiry)) < Date.now()) ||
        fromJson.decisionStale ||
        fromJson.status === 'STALE',
    );
    setDecisionExpiry(expiry ? String(expiry) : null);
    setSearchResult({
      runId: run.id ?? latestId,
      recommendation,
      reasons: fromJson.reasons,
      candidates: candidates.length ? candidates : fromJson.candidates,
      resultChecksum: run.resultChecksum ?? fromJson.resultChecksum ?? undefined,
      inputChecksum: run.inputChecksum ?? fromJson.inputChecksum ?? undefined,
      expiresAt: expiry ? String(expiry) : undefined,
      exactDuplicateBlockers: fromJson.exactDuplicateBlockers,
      decisionStale,
      status: decisionStale ? 'STALE' : fromJson.status,
    });
  }

  async function openSlot(slot: Slot) {
    setSelected(slot);
    setSearchResult(null);
    setDecisionExpiry(null);
    const response = await fetch(`/api/admin/recipe-coverage/slots/${slot.id}/assignments`, {
      cache: 'no-store',
    });
    if (response.ok) {
      const data = (await response.json()) as { items: Assignment[] };
      setAssignments(data.items ?? []);
    } else {
      setAssignments([]);
    }
    await restoreLatestSearch(slot.id);
  }

  async function runSearchPreflight(slot: Slot) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setDecisionExpiry(null);
    try {
      const response = await fetch(`/api/admin/recipe-coverage/slots/${slot.id}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: 'OWNER search-before-generate from coverage UI',
          requestType: 'COVERAGE_SLOT_REVIEW',
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        setMessage(text);
        return;
      }
      const data = JSON.parse(text) as SearchResult;
      setSearchResult({ ...data, status: data.status ?? 'COMPLETED' });
      setMessage(`Search ${data.recommendation ?? '—'} · ${data.resultChecksum?.slice(0, 12) ?? ''}…`);
    } finally {
      setBusy(false);
    }
  }

  async function issueSearchDecision() {
    if (!searchResult?.runId || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/recipe-search/runs/${searchResult.runId}/issue-decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ oneTime: true }),
      });
      const text = await response.text();
      if (!response.ok) {
        setMessage(text);
        return;
      }
      const data = JSON.parse(text) as { expiresAt?: string; recommendation?: string };
      setDecisionExpiry(data.expiresAt ?? null);
      setMessage(`Decision issued · ${data.recommendation ?? ''} · expires ${data.expiresAt ?? ''}`);
    } finally {
      setBusy(false);
    }
  }

  async function seedMatrix() {
    const response = await fetch('/api/admin/recipe-coverage/matrix/seed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    setMessage(response.ok ? 'Matrix seeded + analyzer FULL' : await response.text());
    await reload();
  }

  async function runAnalyze(opts: { mode: string; dryRun: boolean; reason: string }) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/recipe-coverage/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matrixVersion: 'coverage-core-v1',
          mode: opts.mode,
          dryRun: opts.dryRun,
          reason: opts.reason,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        setMessage(text);
        return;
      }
      const data = JSON.parse(text) as Record<string, unknown>;
      setLastResult(data);
      setMessage(
        `${opts.dryRun ? 'Dry-run' : 'Apply'} ${String(data.status)} · semantic=${String(data.semantic)} · ${String(data.durationMs)}ms`,
      );
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <main aria-busy="true">{t('admin.coverage.slots.loading')}</main>;
  if (state === 'forbidden') {
    return <main data-testid="admin-recipe-coverage-forbidden">{t('admin.coverage.slots.forbidden')}</main>;
  }
  if (state === 'error') return <main role="alert">{t('admin.coverage.slots.unavailable')}</main>;

  const lastOk = runs.find((r) => r.status === 'SUCCEEDED' || r.status === 'PARTIAL');
  const portionCandidate =
    searchResult?.recommendation === 'ADJUST_PORTION_OF_EXISTING'
      ? pickPortionCandidate(searchResult.candidates ?? [])
      : null;
  const adaptCandidate =
    searchResult?.recommendation === 'ADAPT_EXISTING_RECIPE'
      ? pickAdaptCandidate(searchResult.candidates ?? [])
      : null;
  const portionFrom = portionCandidate?.nutrition;
  const portionAdj = portionCandidate?.portionAdjustment;
  const adaptSummary = adaptCandidate?.adaptationSummary;
  const constraintLabels = portionCandidate
    ? [...(portionCandidate.failedDimensions ?? []), ...(portionCandidate.unknownDimensions ?? [])].map(
        humanizeDimension,
      )
    : adaptCandidate
      ? [...(adaptCandidate.failedDimensions ?? []), ...(adaptCandidate.unknownDimensions ?? [])].map(
          humanizeDimension,
        )
      : [];

  return (
    <main data-testid="admin-recipe-coverage" style={{ padding: '1rem', maxWidth: 1200, margin: '0 auto' }}>
      <p>
        <Link href="/admin/recipes">{t('admin.common.backToRecipes')}</Link>
      </p>
      <h1>{t('admin.coverage.slots.title')}</h1>
      <p data-testid="coverage-matrix-version">
        {t('admin.coverage.slots.matrixLine', { matrix: 'coverage-core-v1', total: String(total) })}
      </p>
      <section data-testid="coverage-analyzer-panel" style={{ marginBottom: 16, padding: 12, background: '#f7f7f7' }}>
        <h2>{t('admin.coverage.slots.analyzer')}</h2>
        <p data-testid="coverage-last-run">
          {t('admin.coverage.slots.lastRun')}:{' '}
          {lastOk ? `${lastOk.status} · ${lastOk.mode}` : t('admin.coverage.slots.lastRunNone')}
        </p>
        <p data-testid="coverage-dirty-status">
          {t('admin.coverage.slots.dirty')}: {dirty ? t('admin.common.yes') : t('admin.common.no')}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="coverage-analyze-dry"
            disabled={busy}
            onClick={() =>
              void runAnalyze({ mode: 'FULL', dryRun: true, reason: 'OWNER dry-run from coverage UI' })
            }
          >
            {t('admin.coverage.slots.dryRunFull')}
          </button>
          <button
            type="button"
            data-testid="coverage-analyze-full"
            disabled={busy}
            onClick={() =>
              void runAnalyze({ mode: 'FULL', dryRun: false, reason: 'OWNER apply FULL from coverage UI' })
            }
          >
            {t('admin.coverage.slots.applyFull')}
          </button>
          <button
            type="button"
            data-testid="coverage-analyze-incremental"
            disabled={busy || !dirty}
            onClick={() =>
              void runAnalyze({
                mode: 'FULL',
                dryRun: false,
                reason: 'OWNER incremental via dirty retry (FULL safety)',
              })
            }
          >
            {t('admin.coverage.slots.runDirty')}
          </button>
        </div>
        {lastResult ? (
          <details>
            <summary>{t('admin.common.technicalDetails')}</summary>
            <pre data-testid="coverage-analyze-result" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {JSON.stringify(
              {
                runId: lastResult.runId,
                semantic: lastResult.semantic,
                status: lastResult.status,
                inputChecksum: lastResult.inputChecksum,
                resultChecksum: lastResult.resultChecksum,
                exactMatches: lastResult.exactMatches,
                partialMatches: lastResult.partialMatches,
                ambiguousMatches: lastResult.ambiguousMatches,
                assignmentsCreated: lastResult.assignmentsCreated,
                assignmentsUpdated: lastResult.assignmentsUpdated,
                assignmentsStaled: lastResult.assignmentsStaled,
                durationMs: lastResult.durationMs,
              },
              null,
              2,
            )}
          </pre>
          </details>
        ) : null}
        <h3>{t('admin.coverage.slots.recentRuns')}</h3>
        <ul data-testid="coverage-run-list">
          {runs.map((r) => (
            <li key={r.id}>
              {r.createdAt} · {r.status} · {r.mode}
              {r.dryRun ? ' · dry' : ''} · {r.durationMs ?? '—'}ms · cmp {r.comparisonCount}
            </li>
          ))}
        </ul>
      </section>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label>
          {t('admin.coverage.slots.filterMeal')}
          <select data-testid="coverage-filter-meal" value={mealType} onChange={(e) => setMealType(e.target.value)}>
            <option value="">{t('admin.common.all')}</option>
            {Object.keys(MEAL_KEYS).map((code) => (
              <option key={code} value={code}>
                {t(MEAL_KEYS[code])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.coverage.slots.filterPriority')}
          <select
            data-testid="coverage-filter-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">{t('admin.common.all')}</option>
            {Object.keys(PRIORITY_KEYS).map((code) => (
              <option key={code} value={code}>
                {t(PRIORITY_KEYS[code])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.coverage.slots.filterStatus')}
          <select data-testid="coverage-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('admin.common.all')}</option>
            {Object.keys(COVERAGE_STATUS_KEYS).map((code) => (
              <option key={code} value={code}>
                {labelOrEnum(t, code, COVERAGE_STATUS_KEYS)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="coverage-seed" onClick={() => void seedMatrix()}>
          {t('admin.coverage.slots.seed')}
        </button>
      </div>
      {message ? (
        <p role="status" data-testid="coverage-message">
          {message}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p data-testid="coverage-empty">{t('admin.coverage.slots.empty')}</p>
      ) : (
        <ul data-testid="coverage-slot-list" style={{ listStyle: 'none', padding: 0 }}>
          {items.map((slot) => (
            <li key={slot.id} style={{ borderBottom: '1px solid #ddd', padding: '0.6rem 0' }}>
              <button type="button" onClick={() => void openSlot(slot)}>
                {labelOrEnum(t, slot.status, COVERAGE_STATUS_KEYS)} ·{' '}
                {labelOrEnum(t, slot.priority, PRIORITY_KEYS)} · {t(MEAL_KEYS[slot.mealType] ?? 'admin.common.all')} ·{' '}
                {slot.name} · {slot.publishedRecipeCount}/{slot.desiredRecipeCount}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <section data-testid="coverage-slot-detail" style={{ marginTop: 16 }}>
          <h2>{selected.name}</h2>
          <details>
            <summary>{t('admin.common.technicalDetails')}</summary>
            <p data-testid="coverage-slot-key">{selected.slotKey}</p>
          </details>
          <p>
            {selected.dishType} / {selected.cookingMethod ?? 'any method'} · product{' '}
            {selected.primaryProductName ?? '—'}
          </p>
          <p>
            kcal {selected.calorieMin ?? '—'}–{selected.calorieMax ?? '—'} · desired {selected.desiredRecipeCount} ·
            published {selected.publishedRecipeCount}
          </p>
          <p data-testid="coverage-slot-rationale">{selected.rationale}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              type="button"
              data-testid="coverage-search-preflight"
              disabled={busy}
              onClick={() => void runSearchPreflight(selected)}
            >
              Проверить существующие рецепты
            </button>
          </div>
          {searchResult ? (
            <section
              data-testid="coverage-search-panel"
              style={{ marginBottom: 16, padding: 12, background: '#f0f4f8' }}
            >
              <h3>Проверка существующих рецептов</h3>
              <p data-testid="coverage-search-run-status">
                Статус поиска: {searchResult.status ?? (searchResult.runId ? 'COMPLETED' : '—')}
                {searchResult.runId ? ` · run ${searchResult.runId.slice(0, 8)}…` : ''}
              </p>
              <p data-testid="coverage-search-recommendation">
                Рекомендация:{' '}
                {SEARCH_RECOMMENDATION_RU[searchResult.recommendation ?? ''] ??
                  searchResult.recommendation ??
                  '—'}
              </p>
              <p data-testid="coverage-search-reasons">
                Причины: {(searchResult.reasons ?? []).join('; ') || '—'}
              </p>
              {decisionExpiry ? (
                <p data-testid="coverage-search-decision-expiry">
                  Решение действует до: {decisionExpiry}
                  {Date.parse(decisionExpiry) < Date.now() ? (
                    <span data-testid="coverage-search-decision-stale">
                      {' '}
                      · Решение устарело — выполните поиск повторно
                    </span>
                  ) : null}
                </p>
              ) : null}
              {searchResult.decisionStale || searchResult.status === 'STALE' ? (
                <p data-testid="coverage-search-decision-stale" role="status">
                  Решение устарело — выполните поиск повторно
                </p>
              ) : null}
              {portionCandidate && portionFrom && portionAdj ? (
                <section
                  data-testid="coverage-search-portion-panel"
                  style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px solid #ccd' }}
                >
                  <h4>Коррекция порции · {portionCandidate.title}</h4>
                  <p data-testid="coverage-search-portion-from">
                    Исходная порция: {formatMacros(portionFrom)} · {portionFrom.servings} порц.
                  </p>
                  <p data-testid="coverage-search-portion-to">
                    Новая порция:{' '}
                    {portionAdj.calories != null && portionAdj.proteinG != null && portionAdj.fatG != null
                      ? formatMacros({
                          calories: portionAdj.calories,
                          proteinG: portionAdj.proteinG,
                          fatG: portionAdj.fatG,
                        })
                      : '—'}
                  </p>
                  <p data-testid="coverage-search-portion-multiplier">
                    Множитель: {portionAdj.multiplier ?? '—'}
                  </p>
                  <p>
                    Причины:{' '}
                    {[...(searchResult.reasons ?? []), ...(portionCandidate.reasons ?? [])].join('; ') ||
                      '—'}
                  </p>
                  {constraintLabels.length ? (
                    <p>Ограничения: {constraintLabels.join(', ')}</p>
                  ) : null}
                  {portionAdj.reason ? <p>{portionAdj.reason}</p> : null}
                </section>
              ) : null}
              {adaptCandidate && adaptSummary ? (
                <section
                  data-testid="coverage-search-adapt-panel"
                  style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px solid #ccd' }}
                >
                  <h4>Адаптация рецепта · {adaptCandidate.title}</h4>
                  <p data-testid="coverage-search-adapt-source">
                    Исходный продукт:{' '}
                    {productDisplayName(adaptSummary.sourceProductId, selected, 'source', adaptSummary)}
                  </p>
                  <p data-testid="coverage-search-adapt-replacement">
                    Продукт замены:{' '}
                    {productDisplayName(
                      adaptSummary.replacementProductId,
                      selected,
                      'replacement',
                      adaptSummary,
                    )}
                  </p>
                  {adaptSummary.edgeId || adaptSummary.curatedLabel ? (
                    <p data-testid="coverage-search-adapt-curated">
                      {adaptSummary.curatedLabel ?? 'Проверенная замена'}
                    </p>
                  ) : null}
                  <p>
                    Совместимость способа готовки:{' '}
                    {(() => {
                      const ok = cookingMethodCompatible(adaptCandidate);
                      if (ok === true) return 'да';
                      if (ok === false) return 'нет';
                      return 'не проверялось';
                    })()}
                  </p>
                  <p>
                    Пищевой результат: диета{' '}
                    {adaptCandidate.dietaryCompatibility ? 'подходит' : 'не подходит'} · аллергены/
                    оборудование{' '}
                    {adaptCandidate.equipmentCompatibility ? 'учтено' : 'требует проверки'}
                  </p>
                  <p>Статус стоимости: {humanizeCostStatus(adaptCandidate.costStatus)}</p>
                  <p>
                    Причины:{' '}
                    {[...(searchResult.reasons ?? []), ...(adaptCandidate.reasons ?? [])].join('; ') ||
                      '—'}
                  </p>
                  {constraintLabels.length ? (
                    <p>Ограничения: {constraintLabels.join(', ')}</p>
                  ) : null}
                  {adaptSummary.note ? (
                    <p>Примечание: {String(adaptSummary.note).replace(/_/g, ' ')}</p>
                  ) : null}
                </section>
              ) : null}
              <ul data-testid="coverage-search-candidates">
                {(searchResult.candidates ?? []).slice(0, 8).map((c) => (
                  <li key={`${c.recipeVersionId}-${c.rank}`}>
                    #{c.rank}{' '}
                    {SEARCH_RECOMMENDATION_RU[c.candidateType ?? ''] ??
                      String(c.candidateType ?? '').replace(/_/g, ' ')}{' '}
                    · {c.title} · score {c.score}
                    {' · '}
                    <Link href={`/admin/recipes/${c.recipeId}`} data-testid="coverage-search-open-recipe">
                      открыть рецепт
                    </Link>
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-testid="coverage-search-issue-decision"
                  disabled={busy}
                  onClick={() => void issueSearchDecision()}
                >
                  Зафиксировать решение
                </button>
                <Link
                  href={
                    searchResult.exactDuplicateBlockers?.[0]
                      ? `/admin/recipe-duplicates?status=OPEN&candidateId=${searchResult.exactDuplicateBlockers[0]}`
                      : '/admin/recipe-duplicates?status=OPEN&classification=EXACT_DUPLICATE'
                  }
                  data-testid="coverage-search-open-duplicates"
                >
                  Проверка дублей
                </Link>
              </div>
            </section>
          ) : null}
          <h3>{t('admin.coverage.slots.assignments')}</h3>
          <ul data-testid="coverage-assignment-list">
            {assignments.map((a) => (
              <li key={a.id}>
                {a.assignmentType} · {a.recipeName} v{a.versionNumber} · {a.matchStatus} ·{' '}
                {Number(a.matchScore).toFixed(2)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
