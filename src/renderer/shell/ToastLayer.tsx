import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/stores/context';
import type { ErrorStore, Notice } from '@/stores/ErrorStore';

// How long a toast stays on screen before it auto-dismisses. One TTL for every tone — an error that
// needs longer attention is preserved in the durable Errors pane, so the toast never has to be sticky.
// [LAW:no-mode-explosion]
const TOAST_TTL_MS = 6000;

// The always-on transient surface for app notices. It is a pure projection of ErrorStore.activeToasts;
// it owns no notice state of its own — only the per-toast dismissal timer, which is the one piece of
// timing in the feature and lives here at the boundary, never in the store. [LAW:effects-at-boundaries]
export const ToastLayer = observer(function ToastLayer() {
  const { errors } = useStore();
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[90vw] flex-col gap-2"
      data-testid="toast-layer"
    >
      {errors.activeToasts.map((notice) => (
        <Toast key={notice.id} notice={notice} errors={errors} />
      ))}
    </div>
  );
});

// [LAW:no-ambient-temporal-coupling] One toast is the single owner of its own dismissal clock: it arms
// a timer on mount and disarms it on unmount. The effect depends only on stable identities — the
// notice id and the (app-lifetime) store — so the timer is armed exactly once per notice; an unrelated
// rerender of the layer (a sibling toast arriving or leaving) can never restart this toast's clock.
// The store mutation it calls (dismissToast) is pure; the effect that schedules it is here, the only
// place time enters the feature. [LAW:effects-at-boundaries]
function Toast({ notice, errors }: { notice: Notice; errors: ErrorStore }) {
  const id = notice.id;
  useEffect(() => {
    const handle = setTimeout(() => errors.dismissToast(id), TOAST_TTL_MS);
    return () => clearTimeout(handle);
  }, [id, errors]);

  const tone =
    notice.tone === 'error'
      ? 'border-destructive bg-destructive text-destructive-foreground'
      : 'border-border bg-foreground text-background';

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded border px-3 py-2 text-xs shadow-lg ${tone}`}
      data-testid={`toast-${notice.id}`}
      data-tone={notice.tone}
      data-source={notice.source}
    >
      <span className="flex-1 break-words">{notice.message}</span>
      <button
        className="shrink-0 opacity-70 hover:opacity-100"
        onClick={() => errors.dismissToast(id)}
        aria-label="Dismiss notice"
        data-testid={`toast-dismiss-${id}`}
      >
        ×
      </button>
    </div>
  );
}
