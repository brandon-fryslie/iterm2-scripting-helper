import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';
import { cn } from '@/lib/utils';

export const PromptsPane = observer(function PromptsPane() {
  const { monitor } = useStore();
  const sessionFilter = monitor.focusSessionId;
  const entries = sessionFilter
    ? monitor.prompts.entries.filter((e) => e.sessionId === sessionFilter)
    : monitor.prompts.entries;

  return (
    <div className="flex h-full flex-col" data-testid="prompts-pane">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          {monitor.prompts.totalSeen} event(s) seen
          {sessionFilter ? ` · ${sessionFilter.slice(0, 8)}…` : ''}
        </span>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Run a command in the focused session to see prompt events.
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-background text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1 font-medium">#</th>
                <th className="px-3 py-1 font-medium">At</th>
                <th className="px-3 py-1 font-medium">Event</th>
                <th className="px-3 py-1 font-medium">Prompt Id</th>
                <th className="px-3 py-1 font-medium">Command / Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(-200).reverse().map((e) => (
                <tr
                  key={e.seq}
                  className="border-t"
                  data-testid={`prompt-${e.seq}`}
                  data-kind={e.kind}
                >
                  <td className="px-3 py-1 text-muted-foreground">{e.seq}</td>
                  <td className="px-3 py-1 text-muted-foreground">
                    {new Date(e.at).toISOString().slice(11, 23)}
                  </td>
                  <td className="px-3 py-1">
                    <Badge
                      variant={e.kind === 'command-end' ? 'default' : 'outline'}
                      className={cn(
                        e.kind === 'command-end' && e.status !== null && e.status !== 0 &&
                          'bg-destructive text-destructive-foreground',
                      )}
                    >
                      {e.kind}
                    </Badge>
                  </td>
                  <td className="px-3 py-1 text-muted-foreground">
                    {e.uniquePromptId.slice(0, 8)}…
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-1">
                    {e.command !== null && <code>{e.command}</code>}
                    {e.status !== null && (
                      <Badge
                        variant={e.status === 0 ? 'secondary' : 'destructive'}
                        data-testid={`prompt-status-${e.seq}`}
                      >
                        exit {e.status}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
