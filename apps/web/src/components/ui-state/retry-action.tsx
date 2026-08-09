import './ui-state.css';

type Props = {
  label: string;
  onRetry: () => void;
  disabled?: boolean;
  testId?: string;
};

/** Keyboard-accessible retry CTA; no autofocus. */
export function RetryAction({ label, onRetry, disabled, testId = 'ui-retry' }: Props) {
  return (
    <button
      type="button"
      className="ui-retry"
      data-testid={testId}
      onClick={onRetry}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
