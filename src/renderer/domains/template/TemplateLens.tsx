import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FlaskConical, Search, Send, Variable } from 'lucide-react';
import { useStore } from '@/stores/context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { appEntityKey, type AppVariableEntry } from '@shared/domain';
import {
  TEMPLATE_TARGETS,
  applyAvailability,
  unresolvedReferences,
  type TemplatePreview,
} from '@shared/templateDesigner';

// [LAW:decomposition] The Live Template Designer lens: author a badge/title template, preview it against
// the focused session's REAL variables through the one probe seam, and apply it through the one inject
// seam. It owns no interpolation and no variable set — the preview is the probe's verbatim outcome
// ([LAW:one-source-of-truth]) and the insertable names are the canonical live snapshot from MonitorStore.
export const TemplateLens = observer(function TemplateLens() {
  const { entityFocus, monitor, templateDesigner } = useStore();
  const [query, setQuery] = useState('');

  const snap = monitor.variables;
  const focusReady = appEntityKey(snap.entity) === entityFocus.key;
  const sessionId = entityFocus.session?.sessionId ?? null;
  const target = templateDesigner.target;
  const draft = templateDesigner.draft;

  const liveNames = useMemo(() => snap.variables.map((v) => v.name), [snap.variables]);
  const unresolved = useMemo(
    () => (focusReady ? unresolvedReferences(draft, liveNames) : []),
    [focusReady, draft, liveNames],
  );
  const visibleVariables = useMemo(
    () => filterVariables(snap.variables, query),
    [snap.variables, query],
  );

  const availability = applyAvailability(draft, sessionId !== null);
  // [LAW:no-defensive-null-guards] The non-null session id flows into the handler by construction: the
  // handler exists only when there is a session, and the button is disabled unless apply is available.
  const onApply =
    sessionId !== null ? () => void templateDesigner.apply(sessionId) : undefined;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3" data-testid="template-designer">
      <TargetSelector
        activeId={target.id}
        description={target.description}
        applyMode={target.applyMode}
        onSelect={(id) => templateDesigner.setTarget(id)}
      />

      <div className="flex flex-col gap-2">
        <label className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Template
        </label>
        <Input
          aria-label="Template to author"
          className="h-8 font-mono text-xs"
          data-testid="template-draft"
          value={draft}
          onChange={(event) => templateDesigner.setDraft(event.target.value)}
          placeholder="e.g. \(path) — \(jobName)"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8"
            data-testid="template-preview-run"
            disabled={draft.trim() === '' || templateDesigner.preview.state === 'pending'}
            onClick={() => void templateDesigner.runPreview()}
          >
            <FlaskConical className="size-3.5" />
            {templateDesigner.preview.state === 'pending' ? 'Evaluating…' : 'Preview'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            data-testid="template-apply"
            disabled={!availability.ok || templateDesigner.applyPending}
            onClick={onApply}
          >
            <Send className="size-3.5" />
            {templateDesigner.applyPending ? 'Applying…' : `Apply to ${target.label.toLowerCase()}`}
          </Button>
          {!availability.ok && (
            <span className="text-2xs text-muted-foreground" data-testid="template-apply-reason">
              {availability.reason}
            </span>
          )}
        </div>
      </div>

      <PreviewBlock preview={templateDesigner.preview} />

      {unresolved.length > 0 && (
        <div
          className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-2xs text-amber-700 dark:text-amber-400"
          data-testid="template-unresolved"
        >
          Not in this session's live variables:{' '}
          <span className="font-mono">{unresolved.map((r) => `\\(${r})`).join(' ')}</span>. iTerm2
          will resolve them to an error or empty string.
        </div>
      )}

      {templateDesigner.applyResult && (
        <div
          className={cn(
            'rounded px-2 py-1.5 text-2xs',
            templateDesigner.applyResult.ok
              ? 'bg-muted text-muted-foreground'
              : 'bg-destructive/10 text-destructive',
          )}
          data-testid="template-apply-result"
          data-ok={templateDesigner.applyResult.ok ? 'true' : 'false'}
        >
          {templateDesigner.applyResult.ok
            ? `Applied to the ${target.label.toLowerCase()}.`
            : `Apply failed: ${templateDesigner.applyResult.error}`}
        </div>
      )}

      <LiveVariables
        focusReady={focusReady}
        focusKind={entityFocus.kind}
        query={query}
        onQuery={setQuery}
        variables={visibleVariables}
        onInsert={(name) => templateDesigner.insertReference(name)}
      />
    </div>
  );
});

function TargetSelector({
  activeId,
  description,
  applyMode,
  onSelect,
}: {
  activeId: string;
  description: string;
  applyMode: 'live' | 'snapshot';
  onSelect: (id: (typeof TEMPLATE_TARGETS)[number]['id']) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex overflow-hidden rounded border text-xs" data-testid="template-targets">
        {TEMPLATE_TARGETS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cn(
              'flex-1 px-2 py-1',
              t.id === activeId
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
            data-testid={`template-target-${t.id}`}
            data-active={t.id === activeId ? 'true' : 'false'}
            onClick={() => onSelect(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <Badge variant={applyMode === 'live' ? 'default' : 'outline'}>
          {applyMode === 'live' ? 'live' : 'snapshot'}
        </Badge>
        <span>{description}</span>
      </div>
    </div>
  );
}

// [LAW:no-silent-failure] Every preview outcome is a distinct, visible state. An empty render shows an
// explicit "(empty)" marker rather than a blank box, and an error shows iTerm2's reason — the preview is
// never silently absent when a template has been evaluated.
function PreviewBlock({ preview }: { preview: TemplatePreview }) {
  return (
    <div className="flex flex-col gap-1" data-testid="template-preview" data-state={preview.state}>
      <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        Preview
      </span>
      {preview.state === 'idle' && (
        <span className="text-2xs text-muted-foreground">
          Press Preview to evaluate against the focused session.
        </span>
      )}
      {preview.state === 'pending' && (
        <span className="text-2xs text-muted-foreground">Evaluating…</span>
      )}
      {preview.state === 'rendered' && (
        <code
          className="block min-w-0 break-words rounded bg-muted px-1.5 py-1 text-2xs"
          data-testid="template-preview-value"
        >
          {preview.value === '' ? '(empty)' : preview.value}
        </code>
      )}
      {preview.state === 'error' && (
        <code
          className="block min-w-0 break-words rounded bg-destructive/10 px-1.5 py-1 text-2xs text-destructive"
          data-testid="template-preview-error"
        >
          {preview.message}
        </code>
      )}
    </div>
  );
}

function LiveVariables({
  focusReady,
  focusKind,
  query,
  onQuery,
  variables,
  onInsert,
}: {
  focusReady: boolean;
  focusKind: string;
  query: string;
  onQuery: (value: string) => void;
  variables: AppVariableEntry[];
  onInsert: (name: string) => void;
}) {
  if (!focusReady) {
    return (
      <div
        className="rounded border p-3 text-center text-2xs text-muted-foreground"
        data-testid="template-variables"
        data-empty="loading"
      >
        Loading variables for {focusKind}.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="template-variables">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          aria-label="Search live variables"
          className="h-8 pl-8 font-mono text-xs"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Insert a live variable"
        />
      </label>
      <div className="min-h-0 flex-1 divide-y overflow-auto rounded border">
        {variables.length === 0 ? (
          <div className="p-3 text-center text-2xs text-muted-foreground">No variables match.</div>
        ) : (
          variables.map((variable) => (
            <button
              key={variable.name}
              type="button"
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent"
              data-testid={`template-var-${variable.name}`}
              onClick={() => onInsert(variable.name)}
            >
              <Variable className="size-3.5 shrink-0 text-muted-foreground" />
              <code className="min-w-0 shrink-0 truncate text-2xs font-semibold">
                {variable.name}
              </code>
              <code className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                {variable.value}
              </code>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function filterVariables(variables: AppVariableEntry[], query: string): AppVariableEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return variables;
  return variables.filter((variable) => {
    const haystack = `${variable.name}\n${variable.value}`;
    return haystack.toLowerCase().includes(needle);
  });
}
