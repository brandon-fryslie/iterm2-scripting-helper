import { observer } from 'mobx-react-lite';
import { useStore } from '@/stores/context';
import { cn } from '@/lib/utils';

export const LayoutPane = observer(function LayoutPane() {
  const { monitor } = useStore();
  const layout = monitor.layout;

  if (layout.windows.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="layout-pane"
        data-empty="true"
      >
        Connect from the Settings tab to populate this tree.
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col gap-3 overflow-auto p-3 text-xs"
      data-testid="layout-pane"
    >
      <div className="text-muted-foreground">
        {layout.windows.length} window(s) ·{' '}
        {layout.windows.reduce((n, w) => n + w.tabs.length, 0)} tab(s) ·{' '}
        {layout.windows.reduce(
          (n, w) => n + w.tabs.reduce((m, t) => m + t.sessions.length, 0),
          0,
        )}{' '}
        session(s)
      </div>
      {layout.windows.map((w) => (
        <div key={w.windowId} className="rounded border p-2">
          <div className="font-mono text-muted-foreground">
            window {w.windowId.slice(0, 8)}…
          </div>
          {w.tabs.map((t) => (
            <div key={t.tabId} className="ml-3 mt-1">
              <div className="text-muted-foreground">tab {t.tabId}</div>
              {t.sessions.map((s) => {
                const focused = monitor.focusSessionId === s.sessionId;
                return (
                  <button
                    key={s.sessionId}
                    onClick={() => void monitor.focusSession(s.sessionId)}
                    data-testid={`layout-session-${s.sessionId}`}
                    data-focused={focused ? 'true' : 'false'}
                    className={cn(
                      'ml-3 block w-full rounded px-2 py-1 text-left font-mono hover:bg-accent',
                      focused && 'bg-accent font-semibold',
                    )}
                  >
                    {s.sessionId}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}
