import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/stores/context';
import { flatSessions } from '@shared/domain';
import type { ConnectionSnapshot } from '@shared/rpc';

type State = ConnectionSnapshot['state'];

const STATE_LABEL: Record<State, string> = {
  idle: 'Idle',
  detecting: 'Detecting socket',
  'requesting-cookie': 'Requesting cookie',
  connecting: 'Connecting',
  ready: 'Connected',
  error: 'Error',
};

function stateVariant(state: State): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'ready') return 'default';
  if (state === 'error') return 'destructive';
  if (state === 'idle') return 'outline';
  return 'secondary';
}

export const ConnectionPanel = observer(function ConnectionPanel() {
  const { connection } = useStore();
  const snap = connection.snapshot;
  const state: State = snap?.state ?? 'idle';

  return (
    <Card data-testid="settings-connection-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Connection
          <Badge
            variant={stateVariant(state)}
            data-testid="connection-state-badge"
            data-state={state}
          >
            {STATE_LABEL[state]}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Field label="Socket">
          <code
            className="break-all text-xs text-muted-foreground"
            data-testid="socket-path"
          >
            {snap?.socketPath || '(unknown)'}
          </code>{' '}
          <Badge variant={snap?.socketExists ? 'default' : 'destructive'}>
            {snap?.socketExists ? 'present' : 'missing'}
          </Badge>
        </Field>
        <Field label="Protocol version">
          <code data-testid="protocol-version">{snap?.protocolVersion || '(n/a)'}</code>
        </Field>
        <Field label="Advisory name">
          <code>{snap?.advisoryName || '(n/a)'}</code>
        </Field>
        <Field label="Frames seen">
          <code data-testid="frames-seen">{snap?.wireFramesSeen ?? 0}</code>
        </Field>
        <Field label="Last round-trip">
          <code>
            {snap?.lastLatencyMs != null ? `${snap.lastLatencyMs} ms` : '\u2014'}
          </code>
        </Field>
        {snap?.lastError && (
          <>
            <Separator />
            <div
              className="rounded bg-destructive/10 p-2 font-mono text-xs text-destructive"
              data-testid="connection-error"
            >
              {snap.lastError.message}
            </div>
          </>
        )}
        <Separator />
        <div className="flex gap-2">
          <Button
            onClick={() => void connection.connect()}
            disabled={state === 'connecting' || state === 'ready'}
            data-testid="connect-button"
          >
            Connect
          </Button>
          <Button
            variant="outline"
            onClick={() => void connection.disconnect()}
            disabled={state === 'idle'}
            data-testid="disconnect-button"
          >
            Disconnect
          </Button>
          <Button
            variant="secondary"
            onClick={() => void connection.listSessions()}
            disabled={state !== 'ready' || connection.listSessionsInFlight}
            data-testid="list-sessions-button"
          >
            List sessions
          </Button>
        </div>
        {connection.lastSessions && (
          <div
            className="rounded bg-muted p-2 font-mono text-xs"
            data-testid="list-sessions-summary"
          >
            {connection.lastSessions.windows.length} window(s);{' '}
            {connection.lastSessions.windows.reduce(
              (n, w) => n + w.tabs.length,
              0,
            )}{' '}
            tab(s);{' '}
            {connection.lastSessions.windows.reduce(
              (n, w) =>
                n + w.tabs.reduce((m, t) => m + flatSessions(t).length, 0),
              0,
            )}{' '}
            session(s).
          </div>
        )}
      </CardContent>
    </Card>
  );
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
