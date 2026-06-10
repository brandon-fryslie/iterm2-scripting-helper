import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/stores/context';
import {
  APP_ENTITY,
  appEntityKey,
  flatSessions,
  sessionEntityRef,
  tabEntityRef,
  windowEntityRef,
  type AppEntityRef,
  type AppWindow,
} from '@shared/domain';

export const FocusTarget = observer(function FocusTarget() {
  const root = useStore();
  const { entityFocus, monitor } = root;
  const entity = entityFocus.selected;
  const options = focusOptions(monitor.layout.windows);
  const title = options.find((option) => option.key === entityFocus.key)?.label;
  const id = appEntityKey(entity);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded border bg-muted px-3 py-2 text-xs"
      data-testid="console-focus-target"
      data-focus-kind={entity.kind}
    >
      <span className="text-muted-foreground">Focused entity</span>
      <Badge variant="outline">{entity.kind}</Badge>
      <code className="truncate">{title ?? id}</code>
      <Select
        value={entityFocus.key}
        onValueChange={(key) => {
          const option = options.find((item) => item.key === key);
          if (option) void root.selectEntityFocus(option.entity);
        }}
      >
        <SelectTrigger className="ml-auto w-[360px]" data-testid="console-focus-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.key} value={option.key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
});

interface FocusOption {
  key: string;
  label: string;
  entity: AppEntityRef;
}

function focusOptions(windows: AppWindow[]): FocusOption[] {
  const options: FocusOption[] = [
    { key: appEntityKey(APP_ENTITY), label: 'app', entity: APP_ENTITY },
  ];
  for (const window of windows) {
    const windowRef = windowEntityRef(window);
    options.push({
      key: appEntityKey(windowRef),
      label: `window ${window.windowId.slice(0, 8)}`,
      entity: windowRef,
    });
    for (const tab of window.tabs) {
      const tabRef = tabEntityRef(window, tab);
      options.push({
        key: appEntityKey(tabRef),
        label: `tab ${tab.tabId}`,
        entity: tabRef,
      });
      for (const session of flatSessions(tab)) {
        const sessionRef = sessionEntityRef(window, tab, session);
        options.push({
          key: appEntityKey(sessionRef),
          label: session.title || session.sessionId,
          entity: sessionRef,
        });
      }
    }
  }
  return options;
}
