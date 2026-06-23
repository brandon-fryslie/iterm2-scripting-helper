import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  eventFacet,
  eventSummary,
  eventProvenance,
  type ProvenanceLink,
  type ProvenanceRelation,
} from '@shared/activity';
import type { AppEvent, AppEventLogSnapshot } from '@shared/domain';
import { FACET_LABEL } from './facetMeta';

const RELATION_LABEL: Record<ProvenanceRelation, string> = {
  'frame-sibling': 'same frame',
  cause: 'caused by',
  effect: 'caused',
  'request-frame': 'request/response frame',
  'request-origin': 'fired by action',
};

// [LAW:one-source-of-truth] The one rendering of an event's provenance chain, shared by the Events
// lens Detail inspector and the Console lens inline result. Both walk `eventProvenance` over the same
// snapshot and render the links the same way, so the two surfaces can never disagree about what an
// event is linked to. `onNavigate` is the only thing the two callers vary: where a clicked link goes.
export function ProvenanceList({
  snapshot,
  event,
  onNavigate,
}: {
  snapshot: AppEventLogSnapshot;
  event: AppEvent;
  onNavigate: (seq: number) => void;
}) {
  const links = eventProvenance(snapshot, event);
  return (
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
