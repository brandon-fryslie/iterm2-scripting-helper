import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/stores/context';
import { flatSessions } from '@shared/domain';

export const CustomEscapeSubscriber = observer(function CustomEscapeSubscriber() {
  const { workbench, monitor, entityFocus } = useStore();

  useEffect(() => {
    void workbench.refreshCustomEscape();
    const unsub = window.ipc.on('custom-escape-snapshot', (s) =>
      workbench.applyCustomEscapeSnapshot(s),
    );
    return () => unsub();
  }, [workbench]);

  const snap = workbench.customEscapeSnapshot;
  const form = workbench.customEscapeForm;

  const sessions: Array<{ sessionId: string; title: string }> = [];
  for (const w of monitor.layout.windows) {
    for (const t of w.tabs) for (const s of flatSessions(t)) sessions.push({ sessionId: s.sessionId, title: s.title });
  }

  // [LAW:one-source-of-truth] Subscribe to the focused session by default; the picker is an
  // explicit override (empty = follow focus), not a competing source for "which session".
  const targetId = form.sessionId || entityFocus.sessionId || '';
  const usingFocus = form.sessionId === '';
  const targetTitle = sessions.find((s) => s.sessionId === targetId)?.title;

  return (
    <div className="grid gap-4" data-testid="workbench-custom-escape">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Custom Escape Subscriber</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Subscribe to <code>OSC 1337 ; Custom=id=&lt;identity&gt;:...</code> sequences
            on the chosen session. Pair with the Emit-to-session form above to round-trip
            a payload.
          </p>
          <label className="grid grid-cols-[10rem_1fr] items-center gap-2 text-xs">
            <span className="text-muted-foreground">Session</span>
            <Select
              value={form.sessionId || '__focus__'}
              onValueChange={(v) =>
                workbench.updateCustomEscapeForm({ sessionId: v === '__focus__' ? '' : v })
              }
            >
              <SelectTrigger data-testid="custom-escape-session">
                <SelectValue placeholder="Follow focus" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__focus__">Follow focus</SelectItem>
                {sessions.map((s) => (
                  <SelectItem key={s.sessionId} value={s.sessionId}>
                    {s.title || s.sessionId.slice(0, 12) + '…'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div
            className="text-xs text-muted-foreground"
            data-testid="custom-escape-effective-target"
            data-target={targetId || 'none'}
          >
            {targetId ? (
              <>
                Subscribing to{' '}
                <span className="font-mono text-foreground">
                  {targetTitle || targetId.slice(0, 12) + '…'}
                </span>{' '}
                {usingFocus ? '(focused session)' : '(override)'}
              </>
            ) : (
              'No target session — focus a session or override above.'
            )}
          </div>
          <label className="grid grid-cols-[10rem_1fr] items-center gap-2 text-xs">
            <span className="text-muted-foreground">Identity filter</span>
            <Input
              value={form.identity}
              onChange={(e) =>
                workbench.updateCustomEscapeForm({ identity: e.target.value })
              }
              placeholder="(empty = all identities)"
              data-testid="custom-escape-identity"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void workbench.subscribeCustomEscape(targetId)}
              disabled={!targetId}
              data-testid="custom-escape-subscribe"
            >
              Subscribe
            </Button>
            {workbench.customEscapeLastError && (
              <Badge variant="destructive">{workbench.customEscapeLastError}</Badge>
            )}
          </div>
          {snap.subscriptions.length > 0 && (
            <div className="grid gap-1 text-xs">
              {snap.subscriptions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded border px-2 py-1"
                  data-testid={`custom-escape-sub-${s.id}`}
                >
                  <Badge variant="outline">sub</Badge>
                  <span className="font-mono">{s.sessionId.slice(0, 8)}…</span>
                  <span className="text-muted-foreground">
                    {s.identity || '(any identity)'}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => void workbench.unsubscribeCustomEscape(s.id)}
                  >
                    Unsubscribe
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Received payloads</CardTitle>
          <span className="text-xs text-muted-foreground">
            {snap.totalSeen} total
          </span>
        </CardHeader>
        <CardContent className="max-h-[40vh] overflow-auto">
          {snap.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No payloads yet. Emit <code>OSC 1337 ; Custom=id=&lt;identity&gt;:payload</code>
              to the subscribed session to see entries here.
            </p>
          ) : (
            <ul className="grid gap-1 font-mono text-xs">
              {snap.entries
                .slice()
                .reverse()
                .map((e) => (
                  <li
                    key={e.seq}
                    className="flex items-center gap-2 rounded border px-2 py-1"
                    data-testid={`custom-escape-entry-${e.seq}`}
                  >
                    <span className="text-muted-foreground">
                      {new Date(e.at).toISOString().slice(11, 23)}
                    </span>
                    <Badge variant="outline">{e.identity || '(none)'}</Badge>
                    <span className="flex-1 truncate">{e.payload}</span>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
