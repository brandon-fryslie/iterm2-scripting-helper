import { makeAutoObservable, observable } from 'mobx';
import { emptyFleetSnapshot, type FleetSnapshot } from '@shared/fleetQuery';

// [LAW:decomposition] The single owner of the latest fleet snapshot in main. Unlike PromptStore it is not
// focus-scoped — a fleet snapshot is the WHOLE fleet at one capture instant — so it has no focus guard;
// it just holds the most recent capture the orchestrator produced and broadcasts it ([LAW:one-source-of-truth]).
// [LAW:no-shared-mutable-globals] One instance, owned by main; the only writer is apply(), called from the
// orchestrator's coalesced capture.
export class FleetStore {
  // capturedAt 0 is the "never captured" sentinel the renderer reads to show its empty/prompt state.
  current: FleetSnapshot = emptyFleetSnapshot(0);

  constructor() {
    // Held by reference: the snapshot is an immutable value swapped whole by apply(), so a deep proxy
    // would be a second representation that cannot survive structured clone across IPC.
    makeAutoObservable(this, { current: observable.ref });
  }

  apply(snapshot: FleetSnapshot): void {
    this.current = snapshot;
  }

  clear(): void {
    this.current = emptyFleetSnapshot(0);
  }

  snapshot(): FleetSnapshot {
    return this.current;
  }
}
