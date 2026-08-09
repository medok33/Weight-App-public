import './ui-state.css';
import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'error';

type Props = {
  tone?: Tone;
  message: string;
  children?: ReactNode;
  testId?: string;
};

export function InlineNotice({ tone = 'info', message, children, testId = 'ui-inline-notice' }: Props) {
  const isError = tone === 'error';
  return (
    <div
      className={`ui-inline-notice ui-inline-notice--${tone}`}
      data-testid={testId}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <p className="ui-inline-notice__message">{message}</p>
      {children}
    </div>
  );
}
