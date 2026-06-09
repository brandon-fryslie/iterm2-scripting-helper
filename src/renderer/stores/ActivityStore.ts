import { makeAutoObservable, runInAction } from 'mobx';
import type { AppEvent, AppEventLogSnapshot } from '@shared/rpc';
import {
  ACTIVITY_FACETS,
  projectActivity,
  type ActivityFacet,
} from '@shared/activity';

const EMPTY_SNAPSHOT: AppEventLogSnapshot = {
  events: [],
  totalSeen: 0,
  capacity: 0,
  oldestFrameSeq: null,
};

// The renderer's view of the unified event spine. It holds the latest `monitor/events` snapshot and
// the filter/selection VALUES; the rows and provenance are derived purely (see @shared/activity).
//
// [LAW:one-source-of-truth] There is no per-pane mirror here — wire, notifications, keystrokes,
// prompts, focus, the action transcript and the invocation log are all facets of this one snapshot.
export class ActivityStore {
  snapshot: AppEventLogSnapshot = EMPTY_SNAPSHOT;
  // The facets currently shown. Default: every facet (the unfiltered stream).
  readonly visibleFacets = new Set<ActivityFacet>(ACTIVITY_FACETS);
  text = '';
  // The event open in the Detail inspector, identified by its spine seq (stable across refreshes).
  selectedSeq: number | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  apply(snapshot: AppEventLogSnapshot): void {
    this.snapshot = snapshot;
  }

  async hydrate(): Promise<void> {
    const snapshot = await window.ipc.invoke('monitor/events', undefined as never);
    runInAction(() => this.apply(snapshot));
  }

  isFacetVisible(facet: ActivityFacet): boolean {
    return this.visibleFacets.has(facet);
  }

  toggleFacet(facet: ActivityFacet): void {
    if (this.visibleFacets.has(facet)) this.visibleFacets.delete(facet);
    else this.visibleFacets.add(facet);
  }

  showAllFacets(): void {
    for (const facet of ACTIVITY_FACETS) this.visibleFacets.add(facet);
  }

  setText(text: string): void {
    this.text = text;
  }

  select(seq: number): void {
    this.selectedSeq = seq;
  }

  clearSelection(): void {
    this.selectedSeq = null;
  }

  // [LAW:dataflow-not-control-flow] The scope (focused sessionId) rides in as a value, exactly as the
  // old panes received `entityFocus.sessionId`; the projection is the same code path every render.
  visible(sessionId: string | null): AppEvent[] {
    return projectActivity(this.snapshot, {
      facets: this.visibleFacets,
      text: this.text,
      sessionId,
    });
  }

  get selectedEvent(): AppEvent | null {
    if (this.selectedSeq === null) return null;
    return this.snapshot.events.find((e) => e.seq === this.selectedSeq) ?? null;
  }
}
