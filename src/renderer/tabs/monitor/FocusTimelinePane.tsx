import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';

export const FocusTimelinePane = observer(function FocusTimelinePane() {
  const { monitor } = useStore();
  const entries = monitor.focus.entries;

  return (
    <div className="flex h-full flex-col" data-testid="focus-pane">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          {monitor.focus.totalSeen} focus event(s) seen
        </span>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Switch tabs or windows in iTerm2 to populate this timeline.
          </div>
        ) : (
          <ul>
            {entries.slice(-200).reverse().map((e) => (
              <li
                key={e.seq}
                className="flex items-center gap-2 border-b px-3 py-1"
                data-testid={`focus-${e.seq}`}
                data-kind={e.kind}
              >
                <span className="text-muted-foreground">
                  {new Date(e.at).toISOString().slice(11, 23)}
                </span>
                <Badge variant="outline">{e.kind}</Badge>
                <span className="truncate">{e.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});
