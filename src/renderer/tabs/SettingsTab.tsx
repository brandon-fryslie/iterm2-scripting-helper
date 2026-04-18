import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ConnectionPanel } from './settings/ConnectionPanel';
import { AuthorizationPanel } from './settings/AuthorizationPanel';
import { CapabilityPanel } from './settings/CapabilityPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useStore } from '@/stores/context';
import type { RpcResult } from '@shared/rpc';

export const SettingsTab = observer(function SettingsTab() {
  const { connection } = useStore();
  const [ping, setPing] = useState<RpcResult<'system/ping'> | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);

  useEffect(() => {
    void window.ipc
      .invoke('system/ping', undefined as never)
      .then(setPing)
      .catch((e) => setPingError(String(e)));
    void connection.refresh();
    const unsub = window.ipc.on('connection-state', (snap) =>
      connection.apply(snap),
    );
    const unsubFrame = window.ipc.on('wire-frame', () => connection.bumpFrame());
    return () => {
      unsub();
      unsubFrame();
    };
  }, [connection]);

  return (
    <div className="grid gap-4" data-testid="tab-settings-placeholder">
      <ConnectionPanel />
      <AuthorizationPanel />
      <CapabilityPanel />
      <Card>
        <CardHeader>
          <CardTitle>IPC self-test</CardTitle>
        </CardHeader>
        <CardContent>
          <pre
            data-testid="ping-result"
            className="rounded bg-muted p-2 font-mono text-xs"
          >
            {pingError ?? (ping ? JSON.stringify(ping, null, 2) : 'pinging...')}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
});
