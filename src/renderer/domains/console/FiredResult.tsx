import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useStore } from '@/stores/context';
import { eventFacet } from '@shared/activity';
import { ActivityRow } from '@/domains/activity/ActivityRow';
import { ProvenanceList } from '@/domains/activity/ProvenanceList';

// The few most-recent fires kept on screen for cause/effect continuity; older ones live in the Events
// lens. The newest is always the one a fresh fire just produced.
const RECENT_CAP = 6;

// The Console lens's inline cause/effect readout. Firing an action used to surface nothing here — the
// resulting AppEvent landed on the shared spine and was only visible after switching to the Events
// lens. This removes that context switch: the just-fired action and its provenance surface in one
// glance, read from the SAME ActivityStore snapshot the Events timeline projects.
//
// [LAW:one-source-of-truth] There is no second event projection. `activity.visible(...)` is the exact
// projection the Events lens uses; this view is a filter of it (the `action` facet) plus the shared
// `ProvenanceList`. The two surfaces cannot disagree about what a fired event says or links to.
export const FiredResult = observer(function FiredResult() {
  const store = useStore();
  const { activity, entityFocus } = store;
  const sessionId = entityFocus.sessionId;

  // [LAW:dataflow-not-control-flow] The same scope-and-facet filter runs every render; the just-fired
  // event is simply the newest action in scope, since the log appends monotonically by seq.
  const recent = activity
    .visible(sessionId)
    .filter((event) => eventFacet(event) === 'action')
    .slice(0, RECENT_CAP);
  const newestSeq = recent.length > 0 ? recent[0].seq : null;

  // The anchored event — whose provenance is shown — defaults to the newest fire. A fresh fire advances
  // newestSeq and re-anchors to it; the user can pin an earlier fire by clicking its row.
  // [LAW:no-ambient-temporal-coupling] the anchor's reset is keyed explicitly on newestSeq, not on
  // incidental render timing.
  const [pinnedSeq, setPinnedSeq] = useState<number | null>(null);
  useEffect(() => setPinnedSeq(null), [newestSeq]);
  const anchoredSeq = pinnedSeq ?? newestSeq;
  const anchored = recent.find((event) => event.seq === anchoredSeq) ?? null;

  return (
    <Card data-testid="console-result">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Result</CardTitle>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="console-result-empty">
            Fire an action — its spine event and provenance appear here, no lens switch needed.
          </p>
        ) : (
          <div className="grid gap-3 text-xs">
            <ul className="font-mono">
              {recent.map((event) => (
                <ActivityRow
                  key={event.seq}
                  event={event}
                  selected={event.seq === anchoredSeq}
                  onSelect={() => setPinnedSeq(event.seq)}
                />
              ))}
            </ul>

            {anchored && (
              <div className="grid gap-2 border-t pt-2">
                <div className="flex items-center justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => store.inspectEventInEvents(anchored.seq)}
                    data-testid="console-result-open-events"
                  >
                    Open in Events ↗
                  </Button>
                </div>
                <ProvenanceList
                  snapshot={activity.snapshot}
                  event={anchored}
                  onNavigate={(seq) => store.inspectEventInEvents(seq)}
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
