import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useStore } from '@/stores/context';
import { cn } from '@/lib/utils';
import { appEntityKey, type AppVariableEntry, type AppVariableScope } from '@shared/domain';

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
  const focusReady = appEntityKey(snap.entity) === entityFocus.key;
  const visibleVariables = useMemo(
    () => filterVariables(snap.variables, query),
    [snap.variables, query],
  );
  const grouped = useMemo(() => groupVariables(visibleVariables), [visibleVariables]);
  const totalChanged = snap.variables.filter(hasChanged).length;

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

      <div className="flex-1 overflow-auto p-3">
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

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

function VariableScopeGroup({
  scope,
  variables,
}: {
  scope: AppVariableScope;
  variables: AppVariableEntry[];
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
          <VariableRow key={variable.name} variable={variable} />
        ))}
      </div>
    </section>
  );
}

function VariableRow({ variable }: { variable: AppVariableEntry }) {
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
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <code className="min-w-0 truncate text-[11px] font-semibold">{variable.name}</code>
        <div className="flex items-center gap-1">
          <Badge variant="secondary">{variable.scope}</Badge>
          <Badge variant={variable.live ? 'default' : 'outline'}>
            {variable.live ? 'live' : 'static'}
          </Badge>
        </div>
      </div>
      <ValueLine label="current" value={variable.value} />
      <ValueLine label="previous" value={variable.previousValue ?? '-'} muted />
      <div className="text-[11px] text-muted-foreground">
        Changed {formatRelativeTime(variable.updatedAt)}
      </div>
    </div>
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
