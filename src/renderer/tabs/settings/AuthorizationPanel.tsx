import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} m`;
  return `${Math.round(m / 60)} h`;
}

export const AuthorizationPanel = observer(function AuthorizationPanel() {
  const { connection } = useStore();
  const requestedAt = connection.snapshot?.cookieRequestedAt ?? null;
  const age = requestedAt ? Date.now() - requestedAt : null;

  return (
    <Card data-testid="settings-authorization-panel">
      <CardHeader>
        <CardTitle>Authorization</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          The first time the Connect button fires, macOS will prompt for
          Automation permission so this app can talk to iTerm2 via AppleScript.
          The cookie itself lives only in main-process memory and never touches
          disk.
        </p>
        <div className="grid grid-cols-[8rem_1fr] items-center gap-2">
          <span className="text-muted-foreground">Last cookie</span>
          <span data-testid="cookie-age">
            {age != null ? (
              <Badge variant="secondary">{formatAge(age)} ago</Badge>
            ) : (
              <Badge variant="outline">never requested</Badge>
            )}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          If iTerm2 restarts, the cookie becomes invalid and clicking Connect
          re-requests it. If macOS Automation permission is denied, open System
          Settings &rarr; Privacy &amp; Security &rarr; Automation to grant it
          manually.
        </p>
      </CardContent>
    </Card>
  );
});
