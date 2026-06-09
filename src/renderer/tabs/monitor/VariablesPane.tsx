import { useMemo, useState } from 'react';
import { Pin, PinOff, Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/stores/context';
import { cn } from '@/lib/utils';
import {
  appEntityKey,
  type AppProbeResult,
  type AppVariableChange,
  type AppVariableEntry,
  type AppVariableScope,
} from '@shared/domain';

const VARIABLE_SCOPES: readonly AppVariableScope[] = [
  'app',
  'window',
  'tab',
  'session',
  'user',
];

export const VariablesPane = observer(function VariablesPane() {
  const { entityFocus, monitor } = useStore();
  const [query, setQuery] = useState('');
  const snap = monitor.variables;
  const watchedNames = monitor.watchlist.names;
  const focusReady = appEntityKey(snap.entity) === entityFocus.key;
  const visibleVariables = useMemo(
    () => filterVariables(snap.variables, query),
    [snap.variables, query],
  );
  const grouped = useMemo(() => groupVariables(visibleVariables), [visibleVariables]);
  const totalChanged = snap.variables.filter(hasChanged).length;
  const watched = useMemo(() => new Set(watchedNames), [watchedNames]);
  const byName = useMemo(
    () => new Map(snap.variables.map((variable) => [variable.name, variable])),
    [snap.variables],
  );
  const watchItems = useMemo(
    () => watchedNames.map((name) => ({ name, entry: byName.get(name) ?? null })),
    [watchedNames, byName],
  );
  const toggleWatched = (name: string): void => void monitor.toggleWatched(name);

  if (!focusReady) {
    return (
      <div
        className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="variables-pane"
        data-empty="loading"
      >
        Loading variables for {entityFocus.kind}.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col text-xs" data-testid="variables-pane">
      <div className="border-b p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium capitalize">{entityFocus.kind} variables</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {entityFocus.key}
            </div>
          </div>
          <Badge variant={totalChanged > 0 ? 'default' : 'outline'}>
            {totalChanged} changed
          </Badge>
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            aria-label="Search variables"
            className="h-8 pl-8 font-mono text-xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search path or value"
          />
        </label>
      </div>

      <ExpressionProbe />

      <div className="flex-1 overflow-auto p-3">
        <WatchlistSection items={watchItems} onToggleWatched={toggleWatched} />
        {snap.variables.length === 0 ? (
          <EmptyVariables focusKind={entityFocus.kind} />
        ) : visibleVariables.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-muted-foreground">
            No variables match <span className="ml-1 font-mono">{query}</span>.
          </div>
        ) : (
          <div className="space-y-3">
            {VARIABLE_SCOPES.map((scope) => (
              <VariableScopeGroup
                key={scope}
                scope={scope}
                variables={grouped.get(scope) ?? []}
                watched={watched}
                onToggleWatched={toggleWatched}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

const ExpressionProbe = observer(function ExpressionProbe() {
  const { entityFocus, monitor } = useStore();
  const [expression, setExpression] = useState('');
  const result = monitor.probeResult;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (expression.trim() === '') return;
    // [LAW:one-source-of-truth] Evaluate against entityFocus.selected — the observable.ref focus that
    // survives structured clone across IPC. The variables snapshot's entity is a MobX Proxy and would
    // fail to clone, silently rejecting the probe.
    void monitor.runProbe(entityFocus.selected, expression);
  };

  return (
    <div className="border-b p-3" data-testid="variable-probe">
      <form className="flex items-center gap-2" onSubmit={submit}>
        <Input
          aria-label="Variable path or expression to evaluate"
          className="h-8 font-mono text-xs"
          data-testid="variable-probe-input"
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          placeholder="Evaluate path, e.g. session.name"
        />
        <Button
          type="submit"
          size="sm"
          className="h-8 shrink-0"
          data-testid="variable-probe-submit"
          disabled={monitor.probePending || expression.trim() === ''}
        >
          {monitor.probePending ? 'Evaluating…' : 'Evaluate'}
        </Button>
      </form>
      {result ? <ProbeResultLine result={result} /> : null}
    </div>
  );
});

function ProbeResultLine({ result }: { result: AppProbeResult }) {
  return (
    <div
      className="mt-2 space-y-1"
      data-testid="variable-probe-result"
      data-outcome={result.outcome}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <code className="min-w-0 truncate font-semibold">{result.expression}</code>
        <Badge variant="outline">{appEntityKey(result.entity)}</Badge>
      </div>
      <code
        className={cn(
          'block min-w-0 break-words rounded px-1.5 py-1 text-[11px]',
          result.outcome === 'value'
            ? 'bg-muted'
            : 'bg-destructive/10 text-destructive',
        )}
      >
        {result.outcome === 'value' ? result.value : result.message}
      </code>
    </div>
  );
}

function EmptyVariables({ focusKind }: { focusKind: string }) {
  return (
    <div
      className="flex h-full items-center justify-center p-4 text-center text-muted-foreground"
      data-empty="true"
    >
      No variables are loaded for this {focusKind} focus.
    </div>
  );
}

function WatchlistSection({
  items,
  onToggleWatched,
}: {
  items: Array<{ name: string; entry: AppVariableEntry | null }>;
  onToggleWatched: (name: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section data-testid="variables-watchlist" className="mb-3">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background py-1">
        <Pin className="h-3.5 w-3.5 text-primary" />
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          Watching
        </span>
        <Badge variant="outline">{items.length}</Badge>
      </div>
      <div className="divide-y">
        {items.map(({ name, entry }) =>
          entry ? (
            <VariableRow
              key={name}
              variable={entry}
              watched
              onToggleWatched={onToggleWatched}
            />
          ) : (
            <UnobservedWatchRow
              key={name}
              name={name}
              onToggleWatched={onToggleWatched}
            />
          ),
        )}
      </div>
    </section>
  );
}

function UnobservedWatchRow({
  name,
  onToggleWatched,
}: {
  name: string;
  onToggleWatched: (name: string) => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-2"
      data-testid={`watched-variable-${name}`}
      data-observed="false"
    >
      <code className="min-w-0 truncate text-[11px] font-semibold text-muted-foreground">
        {name}
      </code>
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-muted-foreground">not present in focus</span>
        <WatchToggle name={name} watched onToggleWatched={onToggleWatched} />
      </div>
    </div>
  );
}

function VariableScopeGroup({
  scope,
  variables,
  watched,
  onToggleWatched,
}: {
  scope: AppVariableScope;
  variables: AppVariableEntry[];
  watched: Set<string>;
  onToggleWatched: (name: string) => void;
}) {
  if (variables.length === 0) return null;

  return (
    <section data-testid={`variable-scope-${scope}`}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background py-1">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          {scope}
        </span>
        <Badge variant="outline">{variables.length}</Badge>
      </div>
      <div className="divide-y">
        {variables.map((variable) => (
          <VariableRow
            key={variable.name}
            variable={variable}
            watched={watched.has(variable.name)}
            onToggleWatched={onToggleWatched}
          />
        ))}
      </div>
    </section>
  );
}

function VariableRow({
  variable,
  watched,
  onToggleWatched,
}: {
  variable: AppVariableEntry;
  watched: boolean;
  onToggleWatched: (name: string) => void;
}) {
  const changed = hasChanged(variable);

  return (
    <div
      className={cn(
        'grid gap-2 py-2 transition-colors',
        changed && 'bg-primary/10 px-2',
      )}
      data-testid={`variable-${variable.name}`}
      data-live={variable.live ? 'true' : 'false'}
      data-changed={changed ? 'true' : 'false'}
      data-watched={watched ? 'true' : 'false'}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <code className="min-w-0 truncate text-[11px] font-semibold">{variable.name}</code>
        <div className="flex items-center gap-1">
          <Badge variant="secondary">{variable.scope}</Badge>
          <Badge variant={variable.live ? 'default' : 'outline'}>
            {variable.live ? 'live' : 'static'}
          </Badge>
          <WatchToggle
            name={variable.name}
            watched={watched}
            onToggleWatched={onToggleWatched}
          />
        </div>
      </div>
      <ValueLine label="current" value={variable.value} />
      <ValueLine label="previous" value={variable.previousValue ?? '-'} muted />
      <div className="text-[11px] text-muted-foreground">
        Changed {formatRelativeTime(variable.updatedAt)}
      </div>
      <VariableHistory name={variable.name} history={variable.history} />
    </div>
  );
}

function WatchToggle({
  name,
  watched,
  onToggleWatched,
}: {
  name: string;
  watched: boolean;
  onToggleWatched: (name: string) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={watched ? `Unpin ${name}` : `Pin ${name}`}
      aria-pressed={watched}
      data-testid={`watch-toggle-${name}`}
      onClick={() => onToggleWatched(name)}
    >
      {watched ? (
        <PinOff className="text-muted-foreground" />
      ) : (
        <Pin className="text-muted-foreground" />
      )}
    </Button>
  );
}

function VariableHistory({
  name,
  history,
}: {
  name: string;
  history: AppVariableChange[];
}) {
  // history[0] is the current value; prior changes are what's interesting for debugging.
  const priorChanges = history.slice(1);
  if (priorChanges.length === 0) return null;

  return (
    <details className="text-[11px]" data-testid={`variable-history-${name}`}>
      <summary className="cursor-pointer select-none text-muted-foreground">
        {priorChanges.length} prior {priorChanges.length === 1 ? 'change' : 'changes'}
      </summary>
      <ol className="mt-1 space-y-1">
        {priorChanges.map((change, index) => (
          <li
            key={`${change.at}-${index}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2"
          >
            <code className="min-w-0 break-words rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              {change.value}
            </code>
            <span className="text-muted-foreground">{formatRelativeTime(change.at)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function ValueLine({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <code
        className={cn(
          'min-w-0 break-words rounded bg-muted px-1.5 py-1 text-[11px]',
          muted && 'text-muted-foreground',
        )}
      >
        {value}
      </code>
    </div>
  );
}

function filterVariables(
  variables: AppVariableEntry[],
  query: string,
): AppVariableEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return variables;

  return variables.filter((variable) => {
    const haystack = `${variable.name}\n${variable.value}\n${variable.previousValue ?? ''}`;
    return haystack.toLowerCase().includes(needle);
  });
}

function groupVariables(
  variables: AppVariableEntry[],
): Map<AppVariableScope, AppVariableEntry[]> {
  const grouped = new Map<AppVariableScope, AppVariableEntry[]>();
  for (const variable of variables) {
    const scopeVariables = grouped.get(variable.scope) ?? [];
    scopeVariables.push(variable);
    grouped.set(variable.scope, scopeVariables);
  }
  return grouped;
}

function hasChanged(variable: AppVariableEntry): boolean {
  return variable.previousValue !== null && variable.previousValue !== variable.value;
}

function formatRelativeTime(timestamp: number): string {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 1) return 'just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours}h ago`;
}
