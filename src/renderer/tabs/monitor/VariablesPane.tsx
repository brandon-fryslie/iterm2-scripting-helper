import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';

export const VariablesPane = observer(function VariablesPane() {
  const { monitor } = useStore();
  const focused = monitor.focusSessionId;
  const snap = monitor.variables;

  if (!focused) {
    return (
      <div
        className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="variables-pane"
        data-empty="true"
      >
        Click a session in Layout to load its variable tree.
      </div>
    );
  }

  if (snap.sessionId !== focused || snap.variables.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="variables-pane"
        data-empty="loading"
      >
        Loading variables for {focused.slice(0, 12)}…
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-3 text-xs" data-testid="variables-pane">
      <div className="mb-2 text-muted-foreground">
        <code>{focused}</code> · {snap.variables.length} variable(s)
      </div>
      <table className="w-full">
        <thead className="sticky top-0 bg-background text-left text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">Name</th>
            <th className="py-1 font-medium">Value</th>
            <th className="py-1 font-medium">Watch</th>
          </tr>
        </thead>
        <tbody>
          {snap.variables.map((v) => (
            <tr
              key={v.name}
              className="border-t"
              data-testid={`variable-${v.name}`}
              data-live={v.live ? 'true' : 'false'}
            >
              <td className="py-1 pr-3 font-mono">{v.name}</td>
              <td className="max-w-[20rem] truncate py-1 pr-3 font-mono text-muted-foreground">
                {v.value}
              </td>
              <td className="py-1">
                {v.live ? (
                  <Badge variant="default">live</Badge>
                ) : (
                  <Badge variant="outline">static</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
