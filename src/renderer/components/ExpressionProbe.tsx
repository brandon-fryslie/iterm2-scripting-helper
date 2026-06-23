import { observer } from 'mobx-react-lite';
import { FlaskConical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/stores/context';
import { cn } from '@/lib/utils';
import { appEntityKey, type AppProbeResult } from '@shared/domain';

// One probe component, mounted wherever an author needs to resolve a variable/expression
// against the focused entity ([LAW:one-type-per-behavior]): the live-variable inspector and
// the escape-template editor share this exact model rather than minting a second probe.
// [LAW:one-source-of-truth] Draft, result and pending all read from MonitorStore — the probe holds no
// private state — so a variable row that inserts a reference and the user who types both drive the
// one input, and any other mount of this component reflects it.
export const ExpressionProbe = observer(function ExpressionProbe() {
  const { entityFocus, monitor } = useStore();
  const expression = monitor.probeDraft;
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
      <div className="mb-2 flex items-center gap-2">
        <FlaskConical className="h-3.5 w-3.5 text-primary" />
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          Probe
        </span>
        <span className="truncate text-2xs text-muted-foreground">
          evaluate live against <code className="font-mono">{entityFocus.kind}</code>
        </span>
      </div>
      <form className="flex items-center gap-2" onSubmit={submit}>
        <Input
          aria-label="Variable path or expression to evaluate"
          className="h-8 font-mono text-xs"
          data-testid="variable-probe-input"
          value={expression}
          onChange={(event) => monitor.setProbeDraft(event.target.value)}
          placeholder="Evaluate a path or template, e.g. \(session.name)@\(session.hostname)"
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
      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <code className="min-w-0 truncate font-semibold">{result.expression}</code>
        <Badge variant="outline">{appEntityKey(result.entity)}</Badge>
      </div>
      <code
        data-testid="variable-probe-value"
        className={cn(
          'block min-w-0 break-words rounded px-1.5 py-1 text-2xs',
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
