import { observer } from 'mobx-react-lite';
import { useStore } from '@/stores/context';
import { Badge } from '@/components/ui/badge';

export const ScreenPane = observer(function ScreenPane() {
  const { monitor } = useStore();
  const focused = monitor.focusSessionId;
  const snap = monitor.screen;

  if (!focused) {
    return (
      <div
        className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="screen-pane"
        data-empty="true"
      >
        Click a session in Layout to render its screen.
      </div>
    );
  }

  if (snap.sessionId !== focused || snap.lines.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="screen-pane"
        data-empty="loading"
      >
        Rendering {focused.slice(0, 12)}…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="screen-pane">
      <div className="flex items-center gap-2 border-b px-3 py-1 text-xs">
        <code className="text-muted-foreground">{focused.slice(0, 12)}…</code>
        <Badge variant="secondary">{snap.lines.length} lines</Badge>
        {snap.cursor && (
          <Badge variant="outline">
            cursor ({snap.cursor.x}, {snap.cursor.y})
          </Badge>
        )}
        <Badge variant="outline">updates: {snap.updatesReceived}</Badge>
      </div>
      <pre
        className="flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-xs text-zinc-100"
        data-testid="screen-body"
      >
        {snap.lines.map((line) => (
          <div key={line.index} className="min-h-[1em] whitespace-pre">
            {line.text || '\u00a0'}
          </div>
        ))}
      </pre>
    </div>
  );
});
