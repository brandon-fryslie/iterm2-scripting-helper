import { Badge } from '@/components/ui/badge';
import { eventFacet, eventSummary, type ActivityFacet } from '@shared/activity';
import { eventFrameSeq, type AppEvent } from '@shared/domain';
import { FACET_LABEL, formatTime } from './facetMeta';

// One spine event, rendered the SAME way regardless of kind — the facet is a value, not a separate
// component ([LAW:dataflow-not-control-flow]). Clicking selects it for the Detail inspector.
export function ActivityRow({
  event,
  selected,
  onSelect,
}: {
  event: AppEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const facet: ActivityFacet = eventFacet(event);
  const frameSeq = eventFrameSeq(event);
  return (
    <li
      className={`flex cursor-pointer items-start gap-2 border-b px-3 py-1 hover:bg-muted/60 ${
        selected ? 'bg-muted' : ''
      }`}
      data-testid={`activity-row-${event.seq}`}
      data-facet={facet}
      aria-selected={selected}
      onClick={onSelect}
    >
      <span className="w-24 shrink-0 text-muted-foreground">{formatTime(event.at)}</span>
      <Badge variant="outline" className="shrink-0">
        {FACET_LABEL[facet]}
      </Badge>
      <span className="w-12 shrink-0 text-right text-muted-foreground">#{event.seq}</span>
      {frameSeq !== null && (
        <span className="w-16 shrink-0 text-muted-foreground" title="frame seq">
          f{frameSeq}
        </span>
      )}
      <span className="flex-1 truncate">{eventSummary(event)}</span>
    </li>
  );
}
