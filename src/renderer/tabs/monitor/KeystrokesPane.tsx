import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';

export const KeystrokesPane = observer(function KeystrokesPane() {
  const { monitor } = useStore();
  const { entries, advanced, totalSeen } = monitor.keystrokes;
  const sessionFilter = monitor.focusSessionId;
  const visible = sessionFilter
    ? entries.filter((e) => e.sessionId === sessionFilter)
    : entries;

  return (
    <div className="flex h-full flex-col" data-testid="keystrokes-pane">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          {totalSeen} seen
          {sessionFilter ? ` · ${sessionFilter.slice(0, 8)}…` : ''}
        </span>
        <span className="ml-auto" />
        <Button
          size="sm"
          variant={advanced ? 'default' : 'outline'}
          onClick={() => void monitor.setKeystrokeAdvanced(!advanced)}
          data-testid="keystrokes-advanced-toggle"
        >
          {advanced ? 'advanced: on' : 'advanced: off'}
        </Button>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Focus a session and press a key to see events stream in.
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-background text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1 font-medium">#</th>
                <th className="px-3 py-1 font-medium">At</th>
                <th className="px-3 py-1 font-medium">Action</th>
                <th className="px-3 py-1 font-medium">Chars</th>
                <th className="px-3 py-1 font-medium">Modifiers</th>
                <th className="px-3 py-1 font-medium">KC</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(-200).reverse().map((e) => (
                <tr
                  key={e.seq}
                  className="border-t"
                  data-testid={`keystroke-${e.seq}`}
                >
                  <td className="px-3 py-1 text-muted-foreground">{e.seq}</td>
                  <td className="px-3 py-1 text-muted-foreground">
                    {new Date(e.at).toISOString().slice(11, 23)}
                  </td>
                  <td className="px-3 py-1">
                    <Badge variant="outline">{e.action}</Badge>
                  </td>
                  <td className="max-w-[8rem] truncate px-3 py-1">
                    {JSON.stringify(e.characters)}
                  </td>
                  <td className="px-3 py-1">
                    {e.modifiers.map((m) => (
                      <Badge key={m} variant="secondary" className="mr-1">
                        {m}
                      </Badge>
                    ))}
                  </td>
                  <td className="px-3 py-1 text-muted-foreground">{e.keyCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
