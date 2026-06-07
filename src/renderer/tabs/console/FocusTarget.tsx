import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';
import {
  appEntityKey,
  flatSessions,
  sessionEntityRef,
  tabEntityRef,
  windowEntityRef,
  type AppWindow,
} from '@shared/domain';

export const FocusTarget = observer(function FocusTarget() {
  const { entityFocus, monitor } = useStore();
  const entity = entityFocus.selected;
  const title = focusedTitle(entityFocus.key, monitor.layout.windows);
  const id = appEntityKey(entity);

  return (
    <div
      className="flex items-center gap-2 rounded border bg-muted px-3 py-2 text-xs"
      data-testid="console-focus-target"
      data-focus-kind={entity.kind}
    >
      <span className="text-muted-foreground">Focused entity</span>
      <Badge variant="outline">{entity.kind}</Badge>
      <code className="truncate">{title ?? id}</code>
    </div>
  );
});

function focusedTitle(key: string, windows: AppWindow[]): string | null {
  for (const window of windows) {
    if (key === appEntityKey(windowEntityRef(window))) {
      return `window ${window.windowId.slice(0, 8)}`;
    }
    for (const tab of window.tabs) {
      if (key === appEntityKey(tabEntityRef(window, tab))) {
        return `tab ${tab.tabId}`;
      }
      for (const session of flatSessions(tab)) {
        if (key === appEntityKey(sessionEntityRef(window, tab, session))) {
          return session.title || session.sessionId;
        }
      }
    }
  }
  return null;
}
