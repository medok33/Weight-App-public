import type { AppLocale } from './types';

export type MappedApiError = {
  code: string;
  title: string;
  explanation: string;
  recovery?: string;
};

const UNKNOWN_RU: MappedApiError = {
  code: 'UNKNOWN',
  title: 'Не удалось выполнить действие',
  explanation:
    'Повторите попытку. Если ошибка повторится, сообщите идентификатор обращения в поддержку.',
  recovery: 'Повторить',
};

const MAP_RU: Record<string, Omit<MappedApiError, 'code'>> = {
  UNAUTHORIZED: {
    title: 'Требуется вход',
    explanation: 'Войдите в аккаунт, чтобы продолжить.',
    recovery: 'Войти',
  },
  FORBIDDEN: {
    title: 'Нет прав для просмотра раздела',
    explanation: 'У вашей роли нет доступа к этому действию.',
  },
  VALIDATION_ERROR: {
    title: 'Проверьте введённые данные',
    explanation: 'Часть полей заполнена некорректно.',
  },
  NOT_FOUND: {
    title: 'Данные не найдены',
    explanation: 'Запрошенная запись недоступна или была удалена.',
  },
  CONFLICT: {
    title: 'Конфликт изменений',
    explanation: 'Данные изменились. Обновите страницу и повторите действие.',
    recovery: 'Обновить',
  },
  STALE_ACTION: {
    title: 'Действие устарело',
    explanation: 'Состояние изменилось. Обновите данные и повторите попытку.',
    recovery: 'Обновить',
  },
  SOURCE_BLOCKED: {
    title: 'Источник заблокирован',
    explanation: 'Источник рецептов временно недоступен из‑за прав или конфигурации.',
  },
  MEDIA_STORAGE_NOT_CONFIGURED: {
    title: 'Хранилище медиа не настроено',
    explanation: 'Загрузка и проверка медиа недоступны, пока не настроено хранилище.',
  },
  RATE_LIMITED: {
    title: 'Слишком много запросов',
    explanation: 'Подождите немного и повторите попытку.',
  },
  SERVICE_UNAVAILABLE: {
    title: 'Сервис временно недоступен',
    explanation: 'Повторите попытку позже.',
    recovery: 'Повторить',
  },
  DEGRADED_DEPENDENCY: {
    title: 'Часть сервисов недоступна',
    explanation: 'Основные данные могут быть неполными. Повторите попытку чуть позже.',
    recovery: 'Повторить',
  },
  NETWORK: {
    title: 'Нет соединения',
    explanation: 'Проверьте интернет и повторите попытку.',
    recovery: 'Повторить',
  },
  INVALID_LIFECYCLE_TRANSITION: {
    title: 'Недопустимый переход статуса',
    explanation: 'Это действие нельзя выполнить в текущем состоянии версии рецепта.',
  },
};

const UNKNOWN_EN: MappedApiError = {
  code: 'UNKNOWN',
  title: 'Could not complete the action',
  explanation: 'Try again. If the error continues, send the reference ID to support.',
  recovery: 'Retry',
};

const MAP_EN: Record<string, Omit<MappedApiError, 'code'>> = {
  UNAUTHORIZED: { title: 'Sign-in required', explanation: 'Sign in to continue.', recovery: 'Sign in' },
  FORBIDDEN: { title: 'Access denied', explanation: 'Your role cannot perform this action.' },
  VALIDATION_ERROR: { title: 'Check the entered data', explanation: 'Some fields are invalid.' },
  NOT_FOUND: { title: 'Data not found', explanation: 'The requested item is unavailable or was deleted.' },
  CONFLICT: { title: 'Change conflict', explanation: 'The data changed. Refresh and try again.', recovery: 'Refresh' },
  STALE_ACTION: { title: 'Action expired', explanation: 'The state changed. Refresh and try again.', recovery: 'Refresh' },
  SOURCE_BLOCKED: { title: 'Source blocked', explanation: 'The recipe source is unavailable due to permissions or configuration.' },
  MEDIA_STORAGE_NOT_CONFIGURED: { title: 'Media storage is not configured', explanation: 'Media upload and review are unavailable until storage is configured.' },
  RATE_LIMITED: { title: 'Too many requests', explanation: 'Wait a moment and try again.' },
  SERVICE_UNAVAILABLE: { title: 'Service temporarily unavailable', explanation: 'Try again later.', recovery: 'Retry' },
  DEGRADED_DEPENDENCY: { title: 'Some services are unavailable', explanation: 'Data may be incomplete. Try again shortly.', recovery: 'Retry' },
  NETWORK: { title: 'No connection', explanation: 'Check your internet connection and try again.', recovery: 'Retry' },
  INVALID_LIFECYCLE_TRANSITION: { title: 'Invalid status transition', explanation: 'This action is unavailable in the current recipe version state.' },
};

/**
 * Maps stable API error codes to locale-specific user-facing copy.
 * Never use the raw code as the primary UI text.
 */
export function mapApiError(
  code: string | null | undefined,
  options?: { correlationId?: string | null; locale?: AppLocale },
): MappedApiError {
  const normalized = String(code ?? '')
    .trim()
    .toUpperCase();
  const locale = options?.locale ?? 'ru';
  const map = locale === 'en' ? MAP_EN : MAP_RU;
  const unknown = locale === 'en' ? UNKNOWN_EN : UNKNOWN_RU;
  const mapped = normalized ? map[normalized] : undefined;
  const base: MappedApiError = mapped
    ? { code: normalized, ...mapped }
    : { ...unknown, code: normalized || 'UNKNOWN' };

  if (options?.correlationId) {
    return {
      ...base,
      explanation:
        locale === 'en'
          ? `${base.explanation} Reference ID: ${options.correlationId}.`
          : `${base.explanation} Идентификатор обращения: ${options.correlationId}.`,
    };
  }
  return base;
}

export function formatUnknownSafeError(correlationId?: string | null): MappedApiError {
  return mapApiError('UNKNOWN', { correlationId });
}
