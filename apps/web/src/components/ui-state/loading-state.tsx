import './ui-state.css';

type Props = {
  title?: string;
  message: string;
  testId?: string;
};

/** Full-page / section loading state with polite live region. */
export function LoadingState({ title, message, testId = 'ui-loading' }: Props) {
  return (
    <div className="ui-state ui-state--loading" aria-busy="true" data-testid={testId}>
      {title ? <h2 className="ui-state__title">{title}</h2> : null}
      <p className="ui-state__body" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
