import type { RecipeLifecycleStatus, RecipeValidationStatus } from './recipe-lifecycle.policy';

export type RecipeLifecycleAction =
  | 'APPROVE'
  | 'REJECT'
  | 'PUBLISH'
  | 'SUSPEND'
  | 'ARCHIVE'
  | 'RESTORE';

const ACTION_BY_STATUS: Record<RecipeLifecycleStatus, readonly RecipeLifecycleAction[]> = {
  IN_REVIEW: ['APPROVE', 'REJECT'],
  APPROVED: ['PUBLISH', 'REJECT'],
  PUBLISHED: ['SUSPEND', 'ARCHIVE'],
  SUPERSEDED: ['RESTORE', 'ARCHIVE'],
  SUSPENDED: ['RESTORE', 'ARCHIVE'],
  ARCHIVED: [],
  REJECTED: [],
};

export function listAllowedLifecycleActions(input: {
  lifecycleStatus: RecipeLifecycleStatus | string | null | undefined;
  validationStatus?: RecipeValidationStatus | string | null;
  role?: string | null;
}): RecipeLifecycleAction[] {
  const status = String(input.lifecycleStatus ?? '') as RecipeLifecycleStatus;
  const base = [...(ACTION_BY_STATUS[status] ?? [])];
  if (!base.length) return [];

  const validation = String(input.validationStatus ?? 'VALID');
  const role = String(input.role ?? '').toUpperCase();

  return base.filter((action) => {
    if (action === 'RESTORE') {
      if (validation !== 'VALID') return false;
      // SUPERSEDED restore is OWNER-oriented; ADMIN may still call API but UI hides for non-OWNER.
      if (status === 'SUPERSEDED' && role && role !== 'OWNER') return false;
    }
    if (action === 'PUBLISH' && status === 'APPROVED' && validation !== 'VALID') return false;
    return true;
  });
}

export function lifecycleStatusLabelRu(status: string | null | undefined): string {
  switch (String(status ?? '')) {
    case 'IN_REVIEW':
      return 'На проверке';
    case 'APPROVED':
      return 'Одобрена';
    case 'PUBLISHED':
      return 'Опубликована';
    case 'SUPERSEDED':
      return 'Заменена новой';
    case 'SUSPENDED':
      return 'Приостановлена';
    case 'ARCHIVED':
      return 'Архивирована';
    case 'REJECTED':
      return 'Отклонена';
    default:
      return status ? String(status) : 'Не задан';
  }
}

export function lifecycleActionLabelRu(action: RecipeLifecycleAction): string {
  switch (action) {
    case 'APPROVE':
      return 'Одобрить';
    case 'REJECT':
      return 'Отклонить';
    case 'PUBLISH':
      return 'Опубликовать';
    case 'SUSPEND':
      return 'Приостановить';
    case 'ARCHIVE':
      return 'Архивировать';
    case 'RESTORE':
      return 'Восстановить';
    default:
      return action;
  }
}

/**
 * Published label consistency: only PUBLISHED/SUPERSEDED may show as published semantics.
 * publishedAt alone (backfill) must not imply "опубликована".
 */
export function versionPublicationDisplay(input: {
  lifecycleStatus: string | null | undefined;
  publishedAt: Date | string | null | undefined;
}): {
  isPublishedSemantics: boolean;
  publicationLabelRu: string | null;
  readOnlyLabelRu: string | null;
} {
  const status = String(input.lifecycleStatus ?? '');
  const hasPublishedAt = Boolean(input.publishedAt);
  if (status === 'PUBLISHED') {
    return {
      isPublishedSemantics: true,
      publicationLabelRu: 'Опубликована',
      readOnlyLabelRu: 'Только чтение · текущая опубликованная',
    };
  }
  if (status === 'SUPERSEDED') {
    return {
      isPublishedSemantics: true,
      publicationLabelRu: 'Заменена новой',
      readOnlyLabelRu: hasPublishedAt ? 'Историческая опубликованная версия' : 'Историческая версия',
    };
  }
  if (hasPublishedAt && status === 'IN_REVIEW') {
    return {
      isPublishedSemantics: false,
      publicationLabelRu: null,
      readOnlyLabelRu: 'На проверке (publishedAt от backfill — не считать опубликованной)',
    };
  }
  if (hasPublishedAt) {
    return {
      isPublishedSemantics: false,
      publicationLabelRu: null,
      readOnlyLabelRu: 'Есть метка publishedAt без статуса PUBLISHED',
    };
  }
  return { isPublishedSemantics: false, publicationLabelRu: null, readOnlyLabelRu: null };
}
