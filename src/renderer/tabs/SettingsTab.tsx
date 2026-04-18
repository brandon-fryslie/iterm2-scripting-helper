import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RpcResult } from '@shared/rpc';

export function SettingsTab() {
  const [ping, setPing] = useState<RpcResult<'system/ping'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.ipc
      .invoke('system/ping', undefined as never)
      .then(setPing)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <Card data-testid="tab-settings-placeholder">
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Connection, authorization, capability report, and docs index arrive in M1+.
        </p>
        <div>
          <div className="font-medium">IPC bridge self-test</div>
          <pre
            data-testid="ping-result"
            className="mt-1 rounded bg-muted p-2 font-mono text-xs"
          >
            {error ?? (ping ? JSON.stringify(ping, null, 2) : 'pinging...')}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
