'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/locale-provider';

type Action = { code: string; labelRu: string };
type VersionRow = {
  id: string;
  versionNumber: number;
  changeReason: string | null;
  createdAt: string;
  createdBy: string | null;
  lifecycleStatus: string | null;
  lifecycleLabelRu?: string;
  validationStatus: string | null;
  isCurrent?: boolean;
  publishedAt: string | null;
  publication?: { publicationLabelRu?: string | null; readOnlyLabelRu?: string | null; isPublishedSemantics?: boolean };
  checksumShort?: string | null;
  mealItemUsageCount?: number;
  openIssues?: number;
  allowedActions?: Action[];
};

type DependencyRow = {
  id: string;
  productName?: string;
  productId?: string;
  amount?: string | number;
  unit?: string;
  resolutionStatus?: string;
  presentation?: { labelRu?: string };
};

type Workspace = {
  recipe?: {
    id: string;
    name: string;
    recipeKey: string | null;
    dataClass?: string;
    dataClassLabelRu?: string;
    familyName?: string | null;
    currentVersionId?: string | null;
  };
  overview?: {
    lifecycleLabelRu?: string;
    validationStatus?: string | null;
    currentVersionNumber?: number | null;
    eligibleForNewPlans?: boolean;
    ineligibleReasonRu?: string | null;
    coverageSlots?: Array<{ slotId: string; slotKey: string; status: string }>;
  };
  versions?: VersionRow[];
  allowedActions?: Action[];
};

type VersionWorkspace = {
  version?: VersionRow & { recipeName?: string };
  allowedActions?: Action[];
  dependencies?: DependencyRow[];
  revalidationTasks?: Array<Record<string, unknown>>;
  media?: Array<Record<string, unknown>>;
  diff?: Record<string, unknown> | null;
  technical?: Record<string, unknown>;
};

const ACTION_PATH: Record<string, string> = {
  APPROVE: 'approve',
  REJECT: 'reject',
  PUBLISH: 'publish',
  SUSPEND: 'suspend',
  ARCHIVE: 'archive',
  RESTORE: 'restore',
};

const MEDIA_RIGHTS_RU: Record<string, string> = {
  APPROVED: 'Права подтверждены',
  PENDING: 'Права на проверке',
  PENDING_REVIEW: 'Права на проверке',
  REJECTED: 'Права отклонены',
  BLOCKED: 'Права заблокированы',
  TAKEDOWN: 'Снято (takedown)',
  EXPIRED: 'Права истекли',
};

export function RecipeAdminDetailScreen({ recipeId }: { recipeId: string }) {
  const { t } = useI18n();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [versionWorkspace, setVersionWorkspace] = useState<VersionWorkspace | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [tab, setTab] = useState<
    'overview' | 'versions' | 'lifecycle' | 'dependencies' | 'revalidation' | 'media' | 'technical'
  >('overview');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<'loading' | 'error' | 'forbidden' | 'success'>('loading');

  async function reload(preferVersionId?: string | null) {
    setState('loading');
    try {
      const response = await fetch(`/api/admin/recipes/${recipeId}/workspace`, { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) {
        setState('forbidden');
        return;
      }
      if (!response.ok) throw new Error('load_failed');
      const data = (await response.json()) as Workspace;
      setWorkspace(data);
      setState('success');
      const keepId = preferVersionId ?? activeVersionId;
      const preferred =
        (keepId && data.versions?.some((v) => v.id === keepId) && keepId) ||
        data.versions?.find((v) => v.isCurrent)?.id ||
        data.versions?.[data.versions.length - 1]?.id ||
        null;
      if (preferred) await openVersion(preferred, false);
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    void reload();
  }, [recipeId]);

  async function openVersion(versionId: string, switchTab = true) {
    setActiveVersionId(versionId);
    setMessage(null);
    if (switchTab) setTab('versions');
    const response = await fetch(`/api/admin/recipes/${recipeId}/versions/${versionId}/workspace`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      setMessage(await response.text());
      return;
    }
    setVersionWorkspace((await response.json()) as VersionWorkspace);
  }

  async function runLifecycle(action: Action) {
    if (!activeVersionId || pending) return;
    const path = ACTION_PATH[action.code];
    if (!path) return;
    const versionId = activeVersionId;
    setPending(true);
    setMessage(null);
    try {
      const body: Record<string, string> = {
        reasonText: 'Действие из рабочей области',
        reasonCode: action.code === 'REJECT' ? 'REJECT' : 'OWNER_REVIEW',
      };
      const response = await fetch(`/api/admin/recipes/${recipeId}/versions/${versionId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let message = text;
      try {
        const parsed = JSON.parse(text) as { message?: string; code?: string };
        message = parsed.message ?? parsed.code ?? text;
      } catch {
        // keep raw text
      }
      setMessage(response.ok ? t('admin.recipeDetail.actionDone') : message || t('admin.recipeDetail.unavailable'));
      await reload(versionId);
    } finally {
      setPending(false);
    }
  }

  if (state === 'loading') {
    return (
      <main className="admin-workspace" aria-busy="true">
        {t('admin.recipeDetail.loading')}
      </main>
    );
  }
  if (state === 'forbidden') {
    return (
      <main className="admin-workspace" data-testid="admin-recipe-forbidden">
        {t('admin.recipeDetail.forbidden')}
      </main>
    );
  }
  if (state === 'error' || !workspace?.recipe) {
    return (
      <main className="admin-workspace" role="alert">
        {t('admin.recipeDetail.unavailable')}
      </main>
    );
  }

  const recipe = workspace.recipe;
  const versions = workspace.versions ?? [];
  const actions = (versionWorkspace?.allowedActions ?? workspace.allowedActions ?? []) as Action[];
  const deps = versionWorkspace?.dependencies ?? [];
  const tasks = versionWorkspace?.revalidationTasks ?? [];
  const media = versionWorkspace?.media ?? [];

  return (
    <main className="admin-workspace" data-testid="admin-recipe-detail">
      <p>
        <Link href="/admin/recipes">{t('admin.common.backToRecipes')}</Link>
      </p>
      <h1 data-testid="recipe-workspace-title">{recipe.name}</h1>
      <p>
        {t('admin.recipeDetail.key')}: {recipe.recipeKey ?? '—'} · {t('admin.recipeDetail.family')}:{' '}
        {recipe.familyName ?? '—'} · {t('admin.recipeDetail.dataClass')}:{' '}
        {recipe.dataClassLabelRu ?? recipe.dataClass ?? '—'}
      </p>
      {message ? (
        <p role="status" data-testid="recipe-lifecycle-message">
          {message}
        </p>
      ) : null}

      <div role="tablist" className="admin-toolbar">
        {(
          [
            ['overview', t('admin.recipeDetail.tab.overview')],
            ['versions', t('admin.recipeDetail.tab.versions')],
            ['lifecycle', t('admin.recipeDetail.tab.lifecycle')],
            ['dependencies', t('admin.recipeDetail.tab.dependencies')],
            ['revalidation', t('admin.recipeDetail.tab.revalidation')],
            ['media', t('admin.recipeDetail.tab.media')],
            ['technical', t('admin.recipeDetail.tab.technical')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <section data-testid="recipe-overview">
          <p>
            {t('admin.recipeDetail.currentVersion')}: v{workspace.overview?.currentVersionNumber ?? '—'}
          </p>
          <p>
            {t('admin.recipeDetail.lifecycle')}: {workspace.overview?.lifecycleLabelRu ?? '—'}
          </p>
          <p>
            {t('admin.recipeDetail.validation')}: {workspace.overview?.validationStatus ?? '—'}
          </p>
          <p>
            {t('admin.recipeDetail.eligiblePlans')}:{' '}
            {workspace.overview?.eligibleForNewPlans
              ? t('admin.recipeDetail.eligibleYes')
              : `${t('admin.recipeDetail.eligibleNo')} — ${workspace.overview?.ineligibleReasonRu ?? ''}`}
          </p>
          <ul>
            {(workspace.overview?.coverageSlots ?? []).map((slot) => (
              <li key={slot.slotId}>
                <Link href={`/admin/recipe-coverage/slots?selected=${slot.slotId}`}>{slot.slotKey}</Link> ·{' '}
                {slot.status}
              </li>
            ))}
          </ul>
          <section data-testid="recipe-duplicate-panel">
            <h2>{t('admin.recipeDetail.duplicates')}</h2>
            {!(workspace.overview as { duplicateBlockers?: Array<Record<string, unknown>> })?.duplicateBlockers
              ?.length ? (
              <p>{t('admin.recipeDetail.noDuplicateBlockers')}</p>
            ) : (
              <ul>
                {(
                  (workspace.overview as { duplicateBlockers?: Array<Record<string, unknown>> })
                    .duplicateBlockers ?? []
                ).map((dup) => (
                  <li key={String(dup.id)} data-testid={`recipe-duplicate-${dup.id}`}>
                    {String(dup.classification)} · score {String(dup.score)} · group{' '}
                    {String(dup.contentGroupId)} ·{' '}
                    {dup.publicationBlocker ? t('admin.recipeDetail.blocksPublication') : t('admin.recipeDetail.notBlocksPublication')}
                    {' · '}
                    <Link href={String(dup.href)} data-testid={`recipe-duplicate-open-${dup.id}`}>
                      {t('admin.recipeDetail.openDuplicates')}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      ) : null}

      {tab === 'versions' || tab === 'lifecycle' ? (
        <div className="admin-grid">
          <table data-testid="recipe-version-list">
            <thead>
              <tr>
                <th>{t('admin.recipeDetail.tab.versions')}</th>
                <th>{t('admin.recipes.col.updated')}</th>
                <th>{t('admin.common.note')}</th>
                <th>{t('admin.recipes.col.lifecycle')}</th>
                <th>{t('admin.recipes.col.validation')}</th>
                <th>{t('admin.recipeDetail.currentVersion')}</th>
                <th>{t('admin.recipeDetail.tab.media')}</th>
                <th>{t('admin.common.technicalDetails')}</th>
                <th>Позиции рациона</th>
                <th>{t('admin.revalidation.filterStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id} data-testid={`version-row-${version.versionNumber}`}>
                  <td>
                    <button type="button" onClick={() => void openVersion(version.id)}>
                      v{version.versionNumber}
                    </button>
                  </td>
                  <td>{new Date(version.createdAt).toLocaleString('ru-RU')}</td>
                  <td>{version.changeReason ?? '—'}</td>
                  <td data-testid={`version-lifecycle-${version.versionNumber}`}>
                    {version.lifecycleLabelRu ?? version.lifecycleStatus ?? '—'}
                  </td>
                  <td>{version.validationStatus ?? '—'}</td>
                  <td data-testid={`version-current-${version.versionNumber}`}>
                    {version.isCurrent ? 'текущая' : version.lifecycleStatus === 'SUPERSEDED' ? 'историческая' : ''}
                  </td>
                  <td data-testid={`version-publication-${version.versionNumber}`}>
                    {version.publication?.isPublishedSemantics
                      ? version.publication.publicationLabelRu
                      : version.publication?.readOnlyLabelRu &&
                          !/опубликована/i.test(version.publication.readOnlyLabelRu)
                        ? version.publication.readOnlyLabelRu
                        : 'Не опубликована'}
                  </td>
                  <td>{version.checksumShort ?? '—'}</td>
                  <td>{version.mealItemUsageCount ?? 0}</td>
                  <td>{version.openIssues ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }} data-testid="lifecycle-actions">
            {actions.map((action) => (
              <button
                key={action.code}
                type="button"
                disabled={pending}
                data-testid={`lifecycle-${action.code.toLowerCase()}`}
                onClick={() => void runLifecycle(action)}
              >
                {action.labelRu}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'dependencies' ? (
        <section data-testid="recipe-version-dependencies">
          <h2>{t('admin.recipeDetail.tab.dependencies')}</h2>
          {!deps.length ? <p>{t('admin.recipeDetail.noDependencies')}</p> : null}
          <ul>
            {deps.map((dep) => (
              <li key={dep.id}>
                {dep.productName ?? dep.productId} · {dep.amount} {dep.unit} ·{' '}
                {dep.presentation?.labelRu ??
                  (dep.resolutionStatus === 'LEGACY_UNRESOLVED'
                    ? 'Версия КБЖУ продукта не установлена'
                    : dep.resolutionStatus)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === 'revalidation' ? (
        <section data-testid="recipe-revalidation-panel">
          <h2>{t('admin.recipeDetail.tab.revalidation')}</h2>
          <p>
            <Link href="/admin/recipe-revalidation?status=OPEN" data-testid="recipe-revalidation-queue-link">
              {t('admin.recipeDetail.revalidationQueue')}
            </Link>
          </p>
          <ul>
            {tasks.map((task) => (
              <li
                key={String(task.id)}
                data-testid={`revalidation-task-${task.id}`}
                data-critical={task.isCritical ? 'true' : 'false'}
                data-severity={String(task.severity ?? '')}
                style={
                  task.isCritical || task.severity === 'HIGH'
                    ? { borderLeft: '4px solid #b00020', paddingLeft: 8, fontWeight: 600 }
                    : undefined
                }
              >
                <span aria-label={`severity-${String(task.severity)}`}>
                  {task.isCritical ? '⚠ КРИТИЧНО' : task.severity === 'HIGH' ? '↑ Высокий' : 'i Предупреждение'}
                </span>{' '}
                · {String(task.severityLabelRu ?? task.severity)} · {String(task.reasonCode)} ·{' '}
                {String(task.productName ?? task.productId)} · раз {String(task.occurrenceCount ?? 1)}
                {' · '}
                <Link
                  href={`/admin/recipe-revalidation?status=OPEN&taskId=${String(task.id)}`}
                  data-testid={`revalidation-open-${task.id}`}
                >
                  {t('admin.recipeDetail.openTask')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === 'media' ? (
        <section data-testid="recipe-media-panel">
          <h2>{t('admin.recipeDetail.tab.media')}</h2>
          <p>
            <Link href="/admin/media" data-testid="recipe-media-library-link">
              {t('admin.recipeDetail.mediaLibrary')}
            </Link>
          </p>
          <ul>
            {media.map((item) => {
              const rights = String(item.rightsStatus ?? '');
              const label = MEDIA_RIGHTS_RU[rights] ?? rights;
              const eligible = Boolean(item.publicationEligible);
              return (
                <li key={String(item.linkId)} data-testid={`recipe-media-item-${item.linkId}`}>
                  {String(item.role)} · {String(item.altText)} · {label} ·{' '}
                  {eligible ? t('admin.recipeDetail.publicationEligible') : t('admin.recipeDetail.publicationNotEligible')}
                  {' · '}
                  <Link
                    href={`/admin/media?selected=${String(item.mediaAssetId ?? '')}`}
                    data-testid={`recipe-media-open-${item.linkId}`}
                  >
                    {t('admin.recipeDetail.openMedia')}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {tab === 'technical' ? (
        <details data-testid="recipe-technical-snapshot">
          <summary>{t('admin.common.technicalDetails')}</summary>
          <p>{t('admin.recipeDetail.technicalReadOnly')}</p>
          <pre>{JSON.stringify(versionWorkspace?.technical ?? versionWorkspace ?? {}, null, 2)}</pre>
        </details>
      ) : null}
    </main>
  );
}
