import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  eventFacet,
  eventSummary,
  eventProvenance,
  type ProvenanceLink,
  type ProvenanceRelation,
} from '@shared/activity';
import { eventFrameSeq, type AppEvent, type AppEventLogSnapshot } from '@shared/domain';
import { FACET_LABEL, formatTime } from './facetMeta';

const RELATION_LABEL: Record<ProvenanceRelation, string> = {
  'frame-sibling': 'same frame',
  cause: 'caused by',
  effect: 'caused',
  'request-frame': 'request/response frame',
  'request-origin': 'fired by action',
};

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
  const links = eventProvenance(snapshot, event);

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
        <section>
          <h4 className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">
            Provenance
          </h4>
          {links.length === 0 ? (
            <p className="text-muted-foreground">No linked events in the retained window.</p>
          ) : (
            <ul className="grid gap-1">
              {links.map((link, i) => (
                <ProvenanceRow key={i} link={link} onNavigate={onNavigate} />
              ))}
            </ul>
          )}
        </section>

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

function ProvenanceRow({
  link,
  onNavigate,
}: {
  link: ProvenanceLink;
  onNavigate: (seq: number) => void;
}) {
  const relation = RELATION_LABEL[link.relation];
  if (link.target.status === 'found') {
    const target = link.target.event;
    return (
      <li className="flex items-center gap-2" data-testid={`provenance-${link.relation}`}>
        <span className="w-32 shrink-0 text-muted-foreground">{relation}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-auto justify-start gap-2 py-1 text-left font-normal"
          onClick={() => onNavigate(target.seq)}
          data-testid={`provenance-link-${target.seq}`}
        >
          <Badge variant="outline" className="shrink-0">
            {FACET_LABEL[eventFacet(target)]}
          </Badge>
          <span className="text-muted-foreground">#{target.seq}</span>
          <span className="truncate">{eventSummary(target)}</span>
        </Button>
      </li>
    );
  }

  // [LAW:no-silent-failure] A reference that scrolled out of the ring renders loudly, never silently.
  return (
    <li className="flex items-center gap-2" data-testid={`provenance-${link.relation}`}>
      <span className="w-32 shrink-0 text-muted-foreground">{relation}</span>
      <Badge variant="destructive" data-testid={`provenance-${link.target.status}`}>
        {link.target.status === 'evicted' ? 'evicted' : 'unknown'} ({link.target.ref})
      </Badge>
    </li>
  );
}
