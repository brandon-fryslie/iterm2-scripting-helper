import { observer } from 'mobx-react-lite';
import { useStore } from '@/stores/context';
import { cn } from '@/lib/utils';
import {
  appEntityKey,
  flatSessions,
  sessionEntityRef,
  tabEntityRef,
  windowEntityRef,
} from '@shared/domain';

export const LayoutPane = observer(function LayoutPane() {
  const root = useStore();
  const { entityFocus, monitor } = root;
  const layout = monitor.layout;
  const sessionCount =
    layout.buriedSessions.length +
    layout.windows.reduce(
      (n, w) => n + w.tabs.reduce((m, t) => m + flatSessions(t).length, 0),
      0,
    );

  if (layout.windows.length === 0 && layout.buriedSessions.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="layout-pane"
        data-empty="true"
      >
        Open Settings (gear) to connect and populate this tree.
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
        {sessionCount} session(s)
      </div>
      {layout.windows.map((w) => (
        <div
          key={w.windowId}
          className={cn(
            'rounded border p-2',
            entityFocus.key === appEntityKey(windowEntityRef(w)) && 'border-primary',
          )}
        >
          <button
            className="block w-full text-left font-mono text-muted-foreground"
            onClick={() => void root.selectEntityFocus(windowEntityRef(w))}
            data-testid={`layout-window-${w.windowId}`}
            data-focused={
              entityFocus.key === appEntityKey(windowEntityRef(w)) ? 'true' : 'false'
            }
          >
            window {w.windowId.slice(0, 8)}…
          </button>
          {w.tabs.map((t) => {
            const sessions = flatSessions(t);
            const single = sessions.length === 1;
            const tabRef = tabEntityRef(w, t);
            const tabFocused = entityFocus.key === appEntityKey(tabRef);
            return (
              <div key={t.tabId} className={cn('mt-1', !single && 'ml-3')}>
                {!single && (
                  <button
                    className={cn(
                      'block w-full rounded px-2 py-1 text-left font-mono text-muted-foreground hover:bg-accent',
                      tabFocused && 'bg-accent font-semibold text-foreground',
                    )}
                    onClick={() => void root.selectEntityFocus(tabRef)}
                    data-testid={`layout-tab-${t.tabId}`}
                    data-focused={tabFocused ? 'true' : 'false'}
                  >
                    tab {t.tabId}
                  </button>
                )}
                {sessions.map((s) => {
                  const sessionRef = sessionEntityRef(w, t, s);
                  const focused = entityFocus.key === appEntityKey(sessionRef);
                  return (
                    <button
                      key={s.sessionId}
                      onClick={() => void root.selectEntityFocus(sessionRef)}
                      data-testid={`layout-session-${s.sessionId}`}
                      data-focused={focused ? 'true' : 'false'}
                      className={cn(
                        'block w-full rounded px-2 py-1 text-left font-mono hover:bg-accent',
                        !single && 'ml-3',
                        focused && 'bg-accent font-semibold',
                      )}
                    >
                      {s.title || s.sessionId}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
      {layout.buriedSessions.length > 0 && (
        <div className="rounded border border-dashed p-2">
          <div className="mb-1 font-mono text-muted-foreground">buried</div>
          {layout.buriedSessions.map((session) => (
            <div
              key={session.sessionId}
              className="rounded px-2 py-1 font-mono text-muted-foreground"
              data-testid={`layout-buried-session-${session.sessionId}`}
            >
              {session.title || session.sessionId}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
