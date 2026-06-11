import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useStore } from '@/stores/context';
import { diffJson, type JsonValue } from '@shared/jsonDiff';
import type { ActionResult } from '@shared/rpc';

// Read-only API view plus the wire verbs (449.8 lens): iTerm2's Window menu is the canonical
// arrangement editor — this surface shows what that menu never does (the saved JSON, a diff
// between two arrangements, the engine-vs-defaults disagreement) and fires save/restore through
// the same console action the Act bar uses, so every workflow lands on the spine.
export const ArrangementViewer = observer(function ArrangementViewer() {
  const { workbench, console: consoleStore } = useStore();
  const [saveName, setSaveName] = useState('');
  const [lastFired, setLastFired] = useState<{ label: string; result: ActionResult } | null>(null);

  useEffect(() => {
    if (workbench.arrangements === null) void workbench.refreshArrangements();
  }, [workbench]);

  const snap = workbench.arrangements;

  const fire = async (label: string, op: 'save' | 'restore', name: string) => {
    const result = await consoleStore.fire('saved-arrangement', { op, name });
    setLastFired({ label, result });
    await workbench.refreshArrangements();
  };

  const contentsOf = (name: string): JsonValue | null => {
    if (!snap || !snap.contents.ok) return null;
    const value: JsonValue | undefined = snap.contents.arrangements[name];
    return value === undefined ? null : value;
  };

  const inspected = workbench.selectedArrangementName;
  const diffTarget = workbench.diffArrangementName;

  return (
    <div className="grid gap-4" data-testid="workbench-arrangement">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Window Arrangements</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void workbench.refreshArrangements()}
            data-testid="arrangement-refresh"
          >
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Names come from the live engine (SavedArrangementRequest LIST); content is read
            from the <code>com.googlecode.iterm2</code> defaults domain. iTerm2's Window menu
            is the canonical editor — this view saves, restores, inspects, and diffs.
          </p>
          {snap && !snap.names.ok && (
            <Badge variant="destructive" data-testid="arrangement-names-error">
              engine list failed: {snap.names.error}
            </Badge>
          )}
          {snap && !snap.contents.ok && (
            <Badge variant="destructive" data-testid="arrangement-contents-error">
              defaults read failed: {snap.contents.error}
            </Badge>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="New arrangement name"
              className="max-w-[260px]"
              data-testid="arrangement-save-name"
            />
            <Button
              size="sm"
              disabled={!saveName}
              onClick={() => void fire(`save "${saveName}"`, 'save', saveName)}
              data-testid="arrangement-save"
            >
              Save current windows
            </Button>
          </div>
          {lastFired && (
            <Badge
              variant={lastFired.result.ok ? 'secondary' : 'destructive'}
              data-testid="arrangement-last-result"
            >
              {lastFired.label}: {lastFired.result.ok ? 'ok' : lastFired.result.error}
            </Badge>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {workbench.arrangementIndex.length} arrangement(s)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {workbench.arrangementIndex.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="arrangement-empty">
              {snap === null ? 'Loading…' : 'No saved arrangements.'}
            </p>
          ) : (
            <ul className="grid gap-2 text-xs">
              {workbench.arrangementIndex.map((row) => (
                <li
                  key={row.name}
                  className="flex flex-wrap items-center gap-2 rounded border p-2"
                  data-testid={`arrangement-row-${row.name}`}
                >
                  <span className="font-mono">{row.name}</span>
                  {/* Disagreement between the two sources is a fact worth showing, not noise. */}
                  {!row.inEngine && (
                    <Badge variant="destructive">in defaults, unknown to engine</Badge>
                  )}
                  {!row.hasContent && (
                    <Badge variant="destructive">listed by engine, no defaults content</Badge>
                  )}
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    variant={inspected === row.name ? 'default' : 'outline'}
                    onClick={() =>
                      workbench.selectArrangement(inspected === row.name ? null : row.name)
                    }
                    data-testid={`arrangement-inspect-${row.name}`}
                  >
                    Inspect
                  </Button>
                  <Button
                    size="sm"
                    variant={diffTarget === row.name ? 'default' : 'outline'}
                    onClick={() =>
                      workbench.selectDiffArrangement(
                        diffTarget === row.name ? null : row.name,
                      )
                    }
                    data-testid={`arrangement-diff-${row.name}`}
                  >
                    Diff
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void fire(`restore "${row.name}"`, 'restore', row.name)
                    }
                    data-testid={`arrangement-restore-${row.name}`}
                  >
                    Restore as new window(s)
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            To restore into an existing window (or save just one window), use the
            Arrangement action in the Act bar — its window id field carries those variants.
          </p>
        </CardContent>
      </Card>

      {inspected !== null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Inspect: {inspected}</CardTitle>
          </CardHeader>
          <CardContent>
            {contentsOf(inspected) === null ? (
              <p className="text-xs text-muted-foreground" data-testid="arrangement-no-content">
                No readable defaults content for this arrangement.
              </p>
            ) : (
              <pre
                className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[10px]"
                data-testid="arrangement-json"
              >
                {JSON.stringify(contentsOf(inspected), null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {inspected !== null && diffTarget !== null && inspected !== diffTarget && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Diff: {inspected} → {diffTarget}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ArrangementDiff
              before={contentsOf(inspected)}
              after={contentsOf(diffTarget)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
});

function ArrangementDiff({
  before,
  after,
}: {
  before: JsonValue | null;
  after: JsonValue | null;
}) {
  if (before === null || after === null) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="arrangement-diff-missing">
        Both arrangements need readable defaults content to diff.
      </p>
    );
  }
  const entries = diffJson(before, after);
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="arrangement-diff-equal">
        The two arrangements are structurally identical.
      </p>
    );
  }
  return (
    <ul className="grid gap-1 font-mono text-[10px]" data-testid="arrangement-diff-entries">
      {entries.map((entry, idx) => (
        <li key={idx} className="break-all">
          <Badge
            variant={
              entry.kind === 'added'
                ? 'secondary'
                : entry.kind === 'removed'
                  ? 'destructive'
                  : 'outline'
            }
          >
            {entry.kind}
          </Badge>{' '}
          {entry.path || '(root)'}
          {entry.kind !== 'added' && <> − {JSON.stringify(entry.before)}</>}
          {entry.kind !== 'removed' && <> + {JSON.stringify(entry.after)}</>}
        </li>
      ))}
    </ul>
  );
}
