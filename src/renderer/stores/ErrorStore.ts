import { makeAutoObservable } from 'mobx';
import type { FileExportResult, FixtureFileResult } from '@shared/rpc';

// [LAW:one-source-of-truth] The single owner of the app's notice history. Driver failures, fixture
// capture/replay outcomes and Python-stub exports each used to surface through their own inline widget
// (a status span, an export badge, the connection-error block) — three divergent copies of "a failure
// happened". They collapse here: every producer hands the one `record` seam a typed Notice, and both
// the toast layer and the durable Errors pane are pure projections of this list. They can never
// disagree about what the app reported because there is only one list to read.
//
// This mirrors the Activity spine (ActivityStore + projectActivity): one store holds the entries; the
// surfaces are filters of it, never parallel data paths.

// [LAW:types-are-the-program] A notice is durable iff it is an error. `tone` carries that — the Errors
// pane is exactly `tone==='error'`, so success confirmations toast and fade without cluttering the
// durable record. Two tones, not two stores: the toast surface stays one source.
export type NoticeTone = 'error' | 'success';

// The producer a notice came from. Keeps the pane legible (which subsystem failed) and is the
// exhaustive set a new producer must extend deliberately. [LAW:no-mode-explosion]
export type NoticeSource = 'driver' | 'fixture' | 'export';

export interface Notice {
  // Minted by the store — the single place identity is assigned, so no two notices collide and the
  // toast/pane can key on it stably across re-renders. (Same role seq plays on the event spine.)
  id: number;
  at: number;
  tone: NoticeTone;
  source: NoticeSource;
  message: string;
}

export interface NoticeInput {
  tone: NoticeTone;
  source: NoticeSource;
  message: string;
}

// How many toasts to stack at once. Older active toasts beyond this are still in the durable list (if
// errors) — only the on-screen stack is bounded, never the history.
const MAX_TOASTS = 5;

export class ErrorStore {
  notices: Notice[] = [];
  // Toast dismissal is a per-notice fact, not a deletion: an error stays in the durable pane after its
  // toast is gone. Membership here removes a notice from the live toast stack only.
  private readonly dismissedToastIds = new Set<number>();
  private nextId = 1;

  constructor() {
    makeAutoObservable(this);
  }

  // [LAW:single-enforcer] The one place a notice is minted and appended. Producers supply tone/source/
  // message; the store owns id and timestamp so the two surfaces share one identity and one clock.
  record(input: NoticeInput): void {
    this.notices.push({ ...input, id: this.nextId++, at: Date.now() });
  }

  // [LAW:single-enforcer] The one place the cancellable-file-dialog convention becomes a notice: a
  // written/loaded file is a success, a real failure (error a string) is an error, and a user-cancelled
  // dialog (error === null) is a deliberate no-op — never a notice. Both fixture and export results share
  // this exact shape, so the convention lives here once instead of being re-derived at each callsite.
  recordFileOutcome(
    source: NoticeSource,
    result: FileExportResult | FixtureFileResult,
    successMessage: string,
  ): void {
    if (result.ok) this.record({ tone: 'success', source, message: successMessage });
    else if (result.error !== null) this.record({ tone: 'error', source, message: result.error });
  }

  dismissToast(id: number): void {
    this.dismissedToastIds.add(id);
  }

  // Clears the durable history (and the toast stack with it) — the Errors pane's "Clear" action.
  clear(): void {
    this.notices = [];
    this.dismissedToastIds.clear();
  }

  // The live toast stack: the most recent notices not yet dismissed, newest-first, bounded for display.
  get activeToasts(): Notice[] {
    const live = this.notices.filter((n) => !this.dismissedToastIds.has(n.id));
    return live.slice(-MAX_TOASTS).reverse();
  }

  // The durable Errors pane: every error ever recorded, newest-first. Successes are transient and never
  // appear here. [LAW:no-silent-failure] Errors are never evicted — the pane is the durable record the
  // ticket calls for.
  get errors(): Notice[] {
    return this.notices.filter((n) => n.tone === 'error').reverse();
  }

  get errorCount(): number {
    return this.notices.reduce((n, notice) => (notice.tone === 'error' ? n + 1 : n), 0);
  }
}
