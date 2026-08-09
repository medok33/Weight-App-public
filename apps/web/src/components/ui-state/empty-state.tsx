import './ui-state.css';
import type { ReactNode } from 'react';

type Props = {
  title: string;
  message: string;
  action?: ReactNode;
  testId?: string;
};

export function EmptyState({ title, message, action, testId = 'ui-empty' }: Props) {
  return (
    <div className="ui-state ui-state--empty" data-testid={testId}>
      <h2 className="ui-state__title">{title}</h2>
      <p className="ui-state__body" role="status" aria-live="polite">
        {message}
      </p>
      {action ? <div className="ui-state__actions">{action}</div> : null}
    </div>
  );
}
