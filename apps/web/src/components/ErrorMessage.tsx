interface Props {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorMessage({ message, onRetry, retryLabel = 'Try again' }: Props) {
  return (
    <div className="alert alert-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-link" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
