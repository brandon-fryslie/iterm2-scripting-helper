import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/stores/context';
import { ACTIVITY_FACETS } from '@shared/activity';
import { FACET_LABEL } from './facetMeta';
import { ActivityRow } from './ActivityRow';
import { EventDetail } from './EventDetail';

const REFRESH_INTERVAL_MS = 250;
// The spine retains up to 5000 events; rendering every one is needless DOM. Show the most-recent
// slice and say so loudly when older rows are withheld ([LAW:no-silent-failure]).
const RENDER_CAP = 500;

// The unified Activity timeline: one component projecting the whole AppEvent spine, default-scoped to
// the focused entity, filterable by facet + free text. It is the single home for every event stream
// that used to be a bespoke pane (wire, notifications, keystrokes, prompts, focus, the action
// transcript, the RPC invocation log).
export const ActivityTimeline = observer(function ActivityTimeline() {
  const { activity, entityFocus } = useStore();
  const sessionId = entityFocus.sessionId;

  useEffect(() => {
    void activity.hydrate();
    const poll = setInterval(() => void activity.hydrate(), REFRESH_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [activity]);

  const rows = activity.visible(sessionId);
  const shown = rows.slice(0, RENDER_CAP);
  const selected = activity.selectedEvent;

  return (
    <div className="flex h-full flex-col" data-testid="activity-timeline">
      <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs">
        {ACTIVITY_FACETS.map((facet) => (
          <Button
            key={facet}
            size="sm"
            variant={activity.isFacetVisible(facet) ? 'default' : 'outline'}
            onClick={() => activity.toggleFacet(facet)}
            data-testid={`activity-facet-${facet}`}
            aria-pressed={activity.isFacetVisible(facet)}
          >
            {FACET_LABEL[facet]}
          </Button>
        ))}
        <Input
          value={activity.text}
          onChange={(e) => activity.setText(e.target.value)}
          placeholder="Filter text…"
          className="ml-2 h-7 max-w-[220px]"
          data-testid="activity-text-filter"
        />
        <span className="ml-auto text-muted-foreground">
          {sessionId ? (
            <>
              scope <Badge variant="outline">session {sessionId.slice(0, 8)}…</Badge>
            </>
          ) : (
            <>
              scope <Badge variant="outline">all</Badge>
            </>
          )}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-auto font-mono text-xs">
            {shown.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No matching activity.
              </div>
            ) : (
              <ul>
                {shown.map((event) => (
                  <ActivityRow
                    key={event.seq}
                    event={event}
                    selected={selected?.seq === event.seq}
                    onSelect={() => activity.select(event.seq)}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="border-t px-3 py-1 text-xs text-muted-foreground">
            {rows.length > RENDER_CAP
              ? `showing newest ${RENDER_CAP} of ${rows.length} matching · ${activity.snapshot.totalSeen} total seen`
              : `${rows.length} matching · ${activity.snapshot.totalSeen} total seen`}
          </div>
        </div>

        {selected && (
          <div className="w-[420px] shrink-0 overflow-hidden border-l">
            <EventDetail
              snapshot={activity.snapshot}
              event={selected}
              onNavigate={(seq) => activity.select(seq)}
              onClose={() => activity.clearSelection()}
            />
          </div>
        )}
      </div>
    </div>
  );
});
