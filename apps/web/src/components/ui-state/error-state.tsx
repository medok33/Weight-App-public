import './ui-state.css';
import type { ReactNode } from 'react';

type Props = {
  title: string;
  message: string;
  action?: ReactNode;
  testId?: string;
};

export function ErrorState({ title, message, action, testId = 'ui-error' }: Props) {
  return (
    <div className="ui-state ui-state--error" data-testid={testId} role="alert">
      <h2 className="ui-state__title">{title}</h2>
      <p className="ui-state__body" aria-live="assertive">
        {message}
      </p>
      {action ? <div className="ui-state__actions">{action}</div> : null}
    </div>
  );
}
