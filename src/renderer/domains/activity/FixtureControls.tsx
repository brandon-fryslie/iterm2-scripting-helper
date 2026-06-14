import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/stores/context';
import type { FixtureFileResult } from '@shared/rpc';

// Save the whole retained spine as a replayable NDJSON fixture, and replay one back into the
// disconnected timeline. The controls are part of the activity toolbar because a fixture *is* a span
// of the activity spine — there is no separate place a wire-log lives.
//
// [LAW:one-source-of-truth] The outcome (written file, real failure, or user-cancelled no-op) is
// routed through the one ErrorStore — the same seam driver and export failures use — so a fixture
// status surfaces as a toast and any failure lands in the durable Errors pane, never an inline span
// that only this toolbar could show. The cancel convention (error === null) lives in recordFileOutcome.
export function FixtureControls() {
  const { activity, errors } = useStore();
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const res: FixtureFileResult = await window.ipc.invoke('fixture/capture', { span: null });
      errors.recordFileOutcome('fixture', res, res.ok ? `Saved ${res.eventCount} events` : '');
    } finally {
      setBusy(false);
    }
  }

  async function load(): Promise<void> {
    setBusy(true);
    try {
      const res: FixtureFileResult = await window.ipc.invoke('fixture/replay', { path: null });
      // The spine was replaced in the main process; pull the restored snapshot so the timeline shows
      // the recorded session immediately rather than on the next poll tick.
      if (res.ok) await activity.hydrate();
      errors.recordFileOutcome('fixture', res, res.ok ? `Replaying ${res.eventCount} events` : '');
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
    </>
  );
}
