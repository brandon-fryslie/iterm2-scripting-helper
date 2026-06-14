import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/stores/context';
import type { FixtureCaptureResult, FixtureReplayResult } from '@shared/rpc';

// Save the whole retained spine as a replayable NDJSON fixture, and replay one back into the
// disconnected timeline. The controls are part of the activity toolbar because a fixture *is* a span
// of the activity spine — there is no separate place a wire-log lives. A user cancel leaves no status;
// only a written/loaded file or a real failure speaks ([LAW:no-silent-failure]).
export function FixtureControls() {
  const { activity } = useStore();
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const res: FixtureCaptureResult = await window.ipc.invoke('fixture/capture', { span: null });
      if (res.ok) setStatus({ tone: 'ok', text: `saved ${res.eventCount} events` });
      else if (res.error) setStatus({ tone: 'error', text: res.error });
      else setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function load(): Promise<void> {
    setBusy(true);
    try {
      const res: FixtureReplayResult = await window.ipc.invoke('fixture/replay', { path: null });
      if (res.ok) {
        // The spine was replaced in the main process; pull the restored snapshot so the timeline shows
        // the recorded session immediately rather than on the next poll tick.
        await activity.hydrate();
        setStatus({ tone: 'ok', text: `replaying ${res.eventCount} events` });
      } else if (res.error) {
        setStatus({ tone: 'error', text: res.error });
      } else {
        setStatus(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void save()}
        data-testid="fixture-save"
      >
        Save fixture
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void load()}
        data-testid="fixture-load"
      >
        Load fixture
      </Button>
      {status && (
        <span
          className={status.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}
          data-testid="fixture-status"
        >
          {status.text}
        </span>
      )}
    </>
  );
}
