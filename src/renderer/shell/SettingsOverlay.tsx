import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ConnectionPanel } from '@/domains/settings/ConnectionPanel';
import { AuthorizationPanel } from '@/domains/settings/AuthorizationPanel';
import { CapabilityPanel } from '@/domains/settings/CapabilityPanel';
import { ErrorsPanel } from '@/domains/settings/ErrorsPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { RpcResult } from '@shared/rpc';

// Settings/Connection are not about an entity, so they are not a workspace facet — they demote to a
// utility affordance reached from the rail's gear. The connection lifecycle (refresh + live state
// subscription) is owned by the shell, always-on; this overlay only displays it and runs the
// one-shot IPC self-test when opened.
export const SettingsOverlay = observer(function SettingsOverlay({
  onClose,
}: {
  onClose: () => void;
}) {
  const [ping, setPing] = useState<RpcResult<'system/ping'> | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);

  useEffect(() => {
    void window.ipc
      .invoke('system/ping', undefined as never)
      .then(setPing)
      .catch((e) => setPingError(String(e)));
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      data-testid="settings-overlay"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-[480px] max-w-full flex-col gap-4 overflow-auto border-l bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="settings-close"
          >
            Close
          </Button>
        </header>
        <ConnectionPanel />
        <ErrorsPanel />
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
      </aside>
    </div>
  );
});
