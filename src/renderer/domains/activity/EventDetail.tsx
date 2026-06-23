import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { eventFacet } from '@shared/activity';
import { eventFrameSeq, type AppEvent, type AppEventLogSnapshot } from '@shared/domain';
import { FACET_LABEL, formatTime } from './facetMeta';
import { ProvenanceList } from './ProvenanceList';

// The Detail inspector: raw payload + the walkable provenance chain. Selecting an event here is the
// deepest zoom in the timeline — there is no separate Wire/Console/Registration destination.
export function EventDetail({
  snapshot,
  event,
  onNavigate,
  onClose,
}: {
  snapshot: AppEventLogSnapshot;
  event: AppEvent;
  onNavigate: (seq: number) => void;
  onClose: () => void;
}) {
  const facet = eventFacet(event);
  const frameSeq = eventFrameSeq(event);

  return (
    <div className="flex h-full flex-col" data-testid="activity-detail">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <Badge variant="outline">{FACET_LABEL[facet]}</Badge>
        <span className="text-muted-foreground">#{event.seq}</span>
        {frameSeq !== null && <span className="text-muted-foreground">frame {frameSeq}</span>}
        <span className="text-muted-foreground">{formatTime(event.at)}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto px-3 py-2 text-xs">
        <ProvenanceList snapshot={snapshot} event={event} onNavigate={onNavigate} />

        <section>
          <h4 className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">
            Raw payload
          </h4>
          <pre className="overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-2 font-mono">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </section>
      </div>
    </div>
  );
}
