import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';
import {
  applyableDomains,
  assignedSessionIds,
  crossWindowDomainIndices,
  sessionsByWindow,
  staleSessionIds,
} from '@shared/broadcastDomains';
import type { ActionResult } from '@shared/rpc';
import type { AppSession } from '@shared/domain';

// Visual session-to-domain editing over the live broadcast table. Two gestures — drag a chip onto
// a domain, or arm a chip and click "Move here" — feed the one store seam
// (moveBroadcastSession); the gesture is presentation, the move is the operation.
// [LAW:dataflow-not-control-flow] Apply fires the set-broadcast-domains console action directly, so
// every rewrite of the table lands on the event spine — this editor is the whole subject (observe +
// edit + apply), not a view that defers the act-verb to another surface.
export const BroadcastDomainEditor = observer(function BroadcastDomainEditor() {
  const { workbench, console: consoleStore, monitor } = useStore();
  const [lastApply, setLastApply] = useState<ActionResult | null>(null);

  useEffect(() => {
    if (workbench.broadcastDomains === null) void workbench.refreshBroadcastDomains();
  }, [workbench]);

  const live = workbench.broadcastDomains;
  const draft = workbench.broadcastDraft;
  const windows = monitor.layout.windows;
  const pool = sessionsByWindow(windows);
  const titles = new Map<string, AppSession>(
    pool.flatMap((w) => w.sessions.map((s) => [s.sessionId, s] as const)),
  );
  const assigned = draft ? assignedSessionIds(draft) : new Set<string>();
  const crossWindow = draft ? new Set(crossWindowDomainIndices(draft, windows)) : new Set<number>();
  const stale = draft ? new Set(staleSessionIds(draft, windows)) : new Set<string>();
  const armed = workbench.armedBroadcastSessionId;

  const apply = async () => {
    if (!draft) return;
    const result = await consoleStore.fire('set-broadcast-domains', {
      domains: applyableDomains(draft),
    });
    setLastApply(result);
    await workbench.refreshBroadcastDomains();
  };

  const dropProps = (toDomainIndex: number | null) => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const sessionId = e.dataTransfer.getData('text/plain');
      if (sessionId) workbench.moveBroadcastSession(sessionId, toDomainIndex);
    },
  });

  const chip = (sessionId: string) => {
    const session = titles.get(sessionId);
    const isArmed = armed === sessionId;
    return (
      <button
        key={sessionId}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/plain', sessionId)}
        onClick={() => workbench.armBroadcastSession(isArmed ? null : sessionId)}
        className={`flex max-w-full items-center gap-1 rounded border px-2 py-1 text-left font-mono text-2xs ${
          isArmed ? 'border-primary ring-1 ring-primary' : ''
        } ${session ? '' : 'border-destructive text-destructive'}`}
        title={session ? `${session.title} (${sessionId})` : `${sessionId} — not in the current layout`}
        data-testid={`broadcast-chip-${sessionId}`}
        data-armed={isArmed}
      >
        <span className="truncate">{session ? session.title || sessionId : sessionId}</span>
        {!session && <Badge variant="destructive">gone</Badge>}
      </button>
    );
  };

  return (
    <div className="grid gap-4" data-testid="workbench-broadcast-domain">
      {/* The Author facet can be a ~230px column; nothing is pinned to the card's right edge
          (it ends up clipped under the panel scrollbar) — every toolbar is a wrapping row. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Broadcast Domains</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void workbench.refreshBroadcastDomains()}
              data-testid="broadcast-refresh"
            >
              Refresh
            </Button>
            {workbench.broadcastDraftDirty && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => workbench.resetBroadcastDraft()}
                data-testid="broadcast-reset"
              >
                Reset
              </Button>
            )}
            <Button
              size="sm"
              disabled={!draft || !workbench.broadcastDraftDirty}
              onClick={() => void apply()}
              data-testid="broadcast-apply"
            >
              Apply
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Sessions in a domain receive each other's keyboard input. Drag a session onto a
            domain — or click it, then click "Move here". Apply replaces iTerm2's whole table
            atomically; domains must not span windows.
          </p>
          {live && !live.ok && (
            <Badge variant="destructive" data-testid="broadcast-load-error">
              engine read failed: {live.error}
            </Badge>
          )}
          {workbench.broadcastDraftDirty && (
            <Badge variant="outline" data-testid="broadcast-dirty">
              unapplied changes
            </Badge>
          )}
          {lastApply && (
            <Badge
              variant={lastApply.ok ? 'secondary' : 'destructive'}
              data-testid="broadcast-last-result"
            >
              apply: {lastApply.ok ? 'ok' : lastApply.error}
            </Badge>
          )}
        </CardContent>
      </Card>

      {draft === null ? (
        <p className="text-xs text-muted-foreground" data-testid="broadcast-loading">
          {live === null ? 'Loading…' : 'No table loaded — the engine read failed.'}
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {draft.map((domain, idx) => (
              <Card
                key={idx}
                {...dropProps(idx)}
                data-testid={`broadcast-domain-${idx}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-sm">Domain {idx + 1}</CardTitle>
                    {crossWindow.has(idx) && (
                      <Badge variant="destructive" data-testid={`broadcast-cross-window-${idx}`}>
                        spans windows — iTerm2 will refuse
                      </Badge>
                    )}
                    {armed && !domain.includes(armed) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => workbench.moveBroadcastSession(armed, idx)}
                        data-testid={`broadcast-move-here-${idx}`}
                      >
                        Move here
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => workbench.removeBroadcastDomain(idx)}
                      data-testid={`broadcast-remove-domain-${idx}`}
                    >
                      Remove
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex min-h-12 flex-wrap gap-1">
                  {domain.length === 0 ? (
                    <span className="text-2xs text-muted-foreground">
                      Empty — drop sessions here (won't be applied while empty).
                    </span>
                  ) : (
                    domain.map((id) => chip(id))
                  )}
                </CardContent>
              </Card>
            ))}
            <Button
              variant="outline"
              className="min-h-12"
              onClick={() => workbench.addBroadcastDomain()}
              data-testid="broadcast-add-domain"
            >
              + New domain
            </Button>
          </div>

          <Card {...dropProps(null)} data-testid="broadcast-unassigned">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-sm">Not broadcasting</CardTitle>
                {armed && assigned.has(armed) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => workbench.moveBroadcastSession(armed, null)}
                    data-testid="broadcast-unassign"
                  >
                    Move here
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-2">
              {pool.length === 0 && (
                <p className="text-xs text-muted-foreground" data-testid="broadcast-no-sessions">
                  No windows in the layout — connect and refresh the Live state.
                </p>
              )}
              {pool.map((w) => (
                <div key={w.windowId} className="grid gap-1">
                  <span className="text-2xs text-muted-foreground">
                    Window {w.windowNumber} ({w.windowId})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {w.sessions.filter((s) => !assigned.has(s.sessionId)).length === 0 ? (
                      <span className="text-2xs text-muted-foreground">
                        all sessions assigned
                      </span>
                    ) : (
                      w.sessions
                        .filter((s) => !assigned.has(s.sessionId))
                        .map((s) => chip(s.sessionId))
                    )}
                  </div>
                </div>
              ))}
              {stale.size > 0 && (
                <p className="text-2xs text-destructive" data-testid="broadcast-stale-note">
                  {stale.size} session(s) in the draft no longer exist in the layout; applying
                  will be refused until they are removed.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
});
