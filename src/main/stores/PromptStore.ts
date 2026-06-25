import { makeAutoObservable, observable } from 'mobx';
import type { AppPrompt, AppPromptUpdate } from '@shared/domain';
import type { PromptSnapshot } from '@shared/rpc';

// [LAW:decomposition] The single owner of OSC-133 prompt structure for the focused session. It is the
// stateful counterpart to the stateless screenToAnsi seam: a "command block" is split across three
// notifications (prompt → command-start → command-end), and ONLY uniquePromptId ties them together, so
// the correlation must live in a store that accumulates — it cannot be a pure transform over one frame.
// [LAW:no-shared-mutable-globals] One instance, owned by main; the only writers are setFocused (focus
// change) and applyUpdate (a routed prompt notification), both gated on the focused session.
export class PromptStore {
  // [LAW:single-enforcer] The focus guard lives here: an update for a non-focused session is dropped at
  // this one boundary, exactly as ScreenStreamStore drops a buffer for the wrong session.
  private sessionId: string | null = null;
  // Insertion order is prompt-draw order (top-to-bottom on screen); Map preserves it across re-keys.
  private readonly byId = new Map<string, AppPrompt>();
  prompts: AppPrompt[] = [];

  constructor() {
    makeAutoObservable<PromptStore, 'sessionId' | 'byId'>(this, {
      sessionId: false,
      byId: false,
      prompts: observable.ref,
    });
  }

  setFocused(sessionId: string | null): void {
    this.sessionId = sessionId;
    this.byId.clear();
    this.prompts = [];
  }

  applyUpdate(sessionId: string, update: AppPromptUpdate): void {
    if (sessionId !== this.sessionId) return;
    this.byId.set(update.uniquePromptId, mergePrompt(this.byId.get(update.uniquePromptId), update));
    // New array ref so the broadcast autorun observes the change. [LAW:dataflow-not-control-flow]
    this.prompts = [...this.byId.values()];
  }

  clear(): void {
    this.sessionId = null;
    this.byId.clear();
    this.prompts = [];
  }

  snapshot(): PromptSnapshot {
    return { sessionId: this.sessionId, prompts: this.prompts };
  }
}

// The base (id + accumulated regions/command) carried forward across the lifecycle; a later event that
// does not re-deliver a field keeps the prior value rather than nulling it. A 'prompt' event resets the
// base wholesale (a freshly drawn prompt), so it ignores any prior.
function carriedBase(
  prior: AppPrompt | undefined,
  uniquePromptId: string,
): Omit<AppPrompt & { state: 'editing' }, 'state'> {
  return {
    uniquePromptId,
    promptRange: prior?.promptRange ?? null,
    commandRange: prior?.commandRange ?? null,
    outputRange: prior?.outputRange ?? null,
    workingDirectory: prior?.workingDirectory ?? null,
    command: prior?.command ?? null,
  };
}

// [LAW:types-are-the-program] The merge produces the variant whose `state` matches the event; exitStatus
// is added ONLY on command-end, so a 'finished' prompt always carries an exit code and a non-finished one
// never claims to. Exhaustive over the update kinds — a new kind is a compile error here, not a silent
// passthrough.
function mergePrompt(prior: AppPrompt | undefined, update: AppPromptUpdate): AppPrompt {
  switch (update.kind) {
    case 'prompt':
      return {
        uniquePromptId: update.uniquePromptId,
        promptRange: update.promptRange,
        commandRange: update.commandRange,
        outputRange: update.outputRange,
        workingDirectory: update.workingDirectory,
        command: update.command,
        state: 'editing',
      };
    case 'command-start':
      return { ...carriedBase(prior, update.uniquePromptId), command: update.command, state: 'running' };
    case 'command-end':
      return { ...carriedBase(prior, update.uniquePromptId), state: 'finished', exitStatus: update.exitStatus };
  }
}
