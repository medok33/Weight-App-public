'use client';

import { useEffect, useId, useRef, type RefObject } from 'react';
import { useI18n } from '../../../i18n/locale-provider';
import type { ChangeTodayOption } from '../model/change-today-options';

const panelStyle = {
  border: '1px solid var(--ui-border, #d7d7d7)',
  borderRadius: '0.75rem',
  padding: '1rem',
  maxWidth: '28rem',
  width: '100%',
  maxHeight: '85vh',
  overflowY: 'auto',
  background: 'var(--ui-surface, #fff)',
  boxSizing: 'border-box',
} as const;

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getDialogFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

type Props = {
  open: boolean;
  dayIso: string;
  options: ChangeTodayOption[];
  busyKey: string | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelect: (option: ChangeTodayOption) => void;
};

export function ChangeTodaySheet({
  open,
  dayIso,
  options,
  busyKey,
  returnFocusRef,
  onClose,
  onSelect,
}: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused =
      (returnFocusRef?.current as HTMLElement | null) ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const focusInitial = () => {
      const items = getDialogFocusableElements(dialog);
      (closeRef.current ?? items[0] ?? dialog).focus();
    };
    focusInitial();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (busyKey) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = getDialogFocusableElements(dialog);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first || !dialog.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, busyKey, onClose, returnFocusRef]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      data-testid="workout-change-today-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
        padding: '0',
      }}
      onClick={() => {
        if (!busyKey) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={`workout-change-today-sheet-${dayIso}`}
        style={{ ...panelStyle, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: '1.05rem' }}>
              {t('workout.changeTodayTitle')}
            </h2>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--ui-muted, #666)', fontSize: '0.9rem' }}>
              {t('workout.changeTodayHint')}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={Boolean(busyKey)}
            aria-label={t('workout.close')}
            data-testid="workout-change-today-close"
          >
            ✕
          </button>
        </div>

        {options.length === 0 ? (
          <p data-testid={`workout-change-today-empty-${dayIso}`}>
            {t('workout.changeTodayEmpty')}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {options.map((option) => {
              const pending = busyKey === option.id;
              const testId =
                option.kind === 'adaptation'
                  ? `workout-adapt-${dayIso}`
                  : `workout-change-option-${option.replacementType ?? option.id}`;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    data-testid={testId}
                    disabled={Boolean(busyKey)}
                    aria-busy={pending}
                    onClick={() => onSelect(option)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '0.25rem',
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.75rem',
                      borderRadius: '0.75rem',
                      border: '1px solid var(--ui-border, #d7d7d7)',
                      background: 'var(--ui-surface-muted, #f3f3f3)',
                      opacity: busyKey && !pending ? 0.6 : 1,
                      minHeight: '44px',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {t(option.titleKey)}
                      {pending ? '…' : ''}
                    </span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--ui-muted, #666)' }}>
                      {t(option.summaryKey)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
