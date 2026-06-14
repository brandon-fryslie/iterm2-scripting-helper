import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';

// The durable record of every error the app has surfaced — driver failures, fixture and export
// failures. It is a pure projection of ErrorStore.errors (the tone==='error' subset, newest-first);
// the toast layer shows the same notices transiently, the pane keeps them. Settings is the home for
// app-global, non-entity concerns (connection, capabilities, docs), and an error history is one.
export const ErrorsPanel = observer(function ErrorsPanel() {
  const { errors } = useStore();
  const rows = errors.errors;
  return (
    <Card data-testid="settings-errors-panel">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          Errors
          <Badge variant={errors.errorCount > 0 ? 'destructive' : 'outline'}>
            {errors.errorCount}
          </Badge>
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => errors.clear()}
          disabled={rows.length === 0}
          data-testid="settings-errors-clear"
        >
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No errors recorded.</p>
        ) : (
          <ul className="grid gap-2 text-xs">
            {rows.map((notice) => (
              <li
                key={notice.id}
                className="rounded border border-destructive/40 bg-destructive/5 p-2"
                data-testid={`error-row-${notice.id}`}
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Badge variant="outline">{notice.source}</Badge>
                  <time dateTime={new Date(notice.at).toISOString()}>
                    {new Date(notice.at).toLocaleTimeString()}
                  </time>
                </div>
                <div className="mt-1 break-words font-mono text-destructive">{notice.message}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
});
