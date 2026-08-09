import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  InlineNotice,
  LoadingState,
  RetryAction,
} from '../index';

describe('ui-state components', () => {
  it('LoadingState exposes polite live region and busy', () => {
    const html = renderToStaticMarkup(
      createElement(LoadingState, { message: 'Загрузка…', testId: 'ui-loading' }),
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-testid="ui-loading"');
  });

  it('EmptyState renders title and optional CTA slot', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: 'Пусто',
        message: 'Нет данных',
        testId: 'ui-empty',
        action: createElement('a', { href: '/settings' }, 'Профиль'),
      }),
    );
    expect(html).toContain('Пусто');
    expect(html).toContain('Нет данных');
    expect(html).toContain('href="/settings"');
  });

  it('ErrorState uses role=alert', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorState, { title: 'Ошибка', message: 'Сбой', testId: 'ui-error' }),
    );
    expect(html).toContain('role="alert"');
  });

  it('ForbiddenState uses role=alert and never mentions login', () => {
    const html = renderToStaticMarkup(
      createElement(ForbiddenState, {
        title: 'Нет доступа',
        message: 'Запрещено',
        testId: 'ui-forbidden',
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toMatch(/login|вход/i);
  });

  it('InlineNotice success vs error roles', () => {
    const ok = renderToStaticMarkup(
      createElement(InlineNotice, { tone: 'success', message: 'Сохранено', testId: 'n-ok' }),
    );
    const bad = renderToStaticMarkup(
      createElement(InlineNotice, { tone: 'error', message: 'Сбой', testId: 'n-bad' }),
    );
    expect(ok).toContain('role="status"');
    expect(bad).toContain('role="alert"');
  });

  it('RetryAction is a focusable button without autofocus', () => {
    const html = renderToStaticMarkup(
      createElement(RetryAction, { label: 'Повторить', onRetry: () => undefined, testId: 'ui-retry' }),
    );
    expect(html).toContain('type="button"');
    expect(html).not.toContain('autofocus');
    expect(html).toContain('Повторить');
  });
});
