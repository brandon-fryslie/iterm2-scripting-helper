import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';

// [LAW:one-source-of-truth] The paired subscriber owns no target picker and no identity field:
// both arrive as values from the emitter's seam, so "emit to A while subscribed to B" and
// "emit identity X while filtering on Y" are unrepresentable in this workflow.
export const CustomEscapeSubscriber = observer(function CustomEscapeSubscriber({
  targetId,
  targetLabel,
  identity,
}: {
  targetId: string;
  targetLabel: string;
  identity: string;
}) {
  const { workbench } = useStore();

  useEffect(() => {
    void workbench.refreshCustomEscape();
    const unsub = window.ipc.on('custom-escape-snapshot', (s) =>
      workbench.applyCustomEscapeSnapshot(s),
    );
    return () => unsub();
  }, [workbench]);

  const snap = workbench.customEscapeSnapshot;

  return (
    <div className="grid gap-4" data-testid="workbench-custom-escape">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Paired subscriber</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Listens for <code>OSC 1337 ; Custom=id=&lt;identity&gt;:...</code> sequences via
            CustomControlSequenceMonitor. It follows the emitter above: same target session,
            and the identity filter is the template&apos;s <code>identity</code> field.
          </p>
          <div
            className="text-xs text-muted-foreground"
            data-testid="custom-escape-pairing"
            data-target={targetId || 'none'}
            data-identity={identity || 'none'}
          >
            {targetId && identity ? (
              <>
                Will subscribe to identity{' '}
                <span className="font-mono text-foreground">{identity}</span> on{' '}
                <span className="font-mono text-foreground">{targetLabel}</span>
              </>
            ) : !targetId ? (
              'No target session — focus a session or override above.'
            ) : (
              'Fill the identity field above to pair the subscriber.'
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void workbench.subscribeCustomEscape(targetId, identity)}
              disabled={!targetId || !identity}
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
              No payloads yet. Subscribe, then press &ldquo;Emit to session&rdquo; above to
              round-trip the payload into this list.
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
