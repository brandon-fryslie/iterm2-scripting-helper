import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useStore } from '@/stores/context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  FLEET_FIELDS,
  isFleetSnapshotPartial,
  opsForField,
  type FleetConnective,
  type FleetFieldId,
  type FleetSessionRecord,
} from '@shared/fleetQuery';
import type { FleetDraftRow } from '@/stores/FleetStore';
import type { AppEntitySessionRef } from '@shared/domain';

// [LAW:decomposition] The Fleet Query Console lens: the WHOLE fleet (every session × its variable scopes ×
// its OSC-133 exit code) as a queryable dataset. The entity rail inspects ONE entity; this is its natural
// superset. It owns no query semantics — it edits draft rows in FleetStore and renders the DERIVED results
// ([LAW:one-source-of-truth]); evaluation is the pure shared evaluator, focus is the one focus authority.
export const FleetLens = observer(function FleetLens() {
  const root = useStore();
  const fleet = root.fleet;

  // [LAW:effects-at-boundaries] Opening the lens captures a fresh snapshot once. The capture is the IO
  // boundary; everything after (editing the query, re-evaluating) is pure and bridge-free.
  useEffect(() => {
    void fleet.refresh();
  }, [fleet]);

  const snapshot = fleet.current;
  const partial = isFleetSnapshotPartial(snapshot);
  const recordsById = new Map(snapshot.sessions.map((session) => [session.ref.sessionId, session]));
  const results = fleet.results;
  const captured = snapshot.capturedAt > 0;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3" data-testid="fleet-console">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fleet.refresh()}
          data-testid="fleet-refresh"
        >
          <RefreshCw className={cn('size-3.5', fleet.refreshing && 'animate-spin')} />
          Refresh
        </Button>
        <span className="text-xs text-muted-foreground" data-testid="fleet-session-count">
          {captured ? `${snapshot.sessions.length} sessions` : 'No capture yet'}
        </span>
        {partial && (
          <Badge variant="destructive" data-testid="fleet-partial">
            {snapshot.failures.length} unreadable
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-md border bg-card/40 p-2">
        <div className="flex items-center justify-between">
          <ConnectiveToggle
            connective={fleet.connective}
            multiRow={fleet.rows.length > 1}
            onChange={(c) => fleet.setConnective(c)}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fleet.clearRows()}
            disabled={fleet.rows.length === 0}
            data-testid="fleet-clear"
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
        {fleet.rows.map((row, index) => (
          <QueryRow
            key={row.id}
            row={row}
            index={index}
            onField={(field) => fleet.setRowField(row.id, field)}
            onOp={(op) => fleet.setRowOp(row.id, op)}
            onValue={(value) => fleet.setRowValue(row.id, value)}
            onRemove={() => fleet.removeRow(row.id)}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => fleet.addRow()}
          data-testid="fleet-add"
        >
          <Plus className="size-3.5" />
          Add filter
        </Button>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span data-testid="fleet-result-count">{results.length}</span>
        <span>matching {results.length === 1 ? 'session' : 'sessions'}</span>
      </div>

      <ol className="flex flex-col gap-1">
        {results.map((ref) => (
          <ResultRow
            key={ref.sessionId}
            sessionRef={ref}
            record={recordsById.get(ref.sessionId)}
            onClick={() => void root.selectEntityFocus(ref)}
          />
        ))}
      </ol>

      {captured && results.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="fleet-empty">
          No session matches the current query.
        </p>
      )}

      {partial && (
        <ul className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
          {snapshot.failures.map((failure) => (
            <li key={failure.ref.sessionId} data-testid="fleet-failure">
              Could not read {failure.ref.sessionId}: {failure.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

function ConnectiveToggle({
  connective,
  multiRow,
  onChange,
}: {
  connective: FleetConnective;
  multiRow: boolean;
  onChange: (connective: FleetConnective) => void;
}) {
  // The connective only changes behavior with more than one predicate, so it is shown only then — one row
  // has no "and/or" to choose ([LAW:dataflow-not-control-flow] the choice is meaningful only as a value
  // joining multiple predicates).
  if (!multiRow) return <span className="text-xs text-muted-foreground">Filters</span>;
  return (
    <div className="flex overflow-hidden rounded border text-xs" data-testid="fleet-connective">
      {(['and', 'or'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={cn(
            'px-2 py-0.5 uppercase',
            connective === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
          onClick={() => onChange(option)}
          data-testid={`fleet-connective-${option}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function QueryRow({
  row,
  index,
  onField,
  onOp,
  onValue,
  onRemove,
}: {
  row: FleetDraftRow;
  index: number;
  onField: (field: FleetFieldId) => void;
  onOp: (op: string) => void;
  onValue: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5" data-testid="fleet-row">
      <Select value={row.field} onValueChange={(value) => onField(value as FleetFieldId)}>
        <SelectTrigger className="h-8 w-40" data-testid={`fleet-field-${index}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FLEET_FIELDS.map((field) => (
            <SelectItem key={field.id} value={field.id}>
              {field.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={row.op} onValueChange={onOp}>
        <SelectTrigger className="h-8 w-32" data-testid={`fleet-op-${index}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opsForField(row.field).map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="h-8 flex-1 font-mono"
        value={row.value}
        placeholder="value"
        onChange={(event) => onValue(event.target.value)}
        data-testid={`fleet-value-${index}`}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={onRemove}
        data-testid={`fleet-remove-${index}`}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function ResultRow({
  sessionRef,
  record,
  onClick,
}: {
  sessionRef: AppEntitySessionRef;
  record: FleetSessionRecord | undefined;
  onClick: () => void;
}) {
  const pwd = record?.variables['path'] ?? null;
  const exit =
    record?.lastPrompt?.state === 'finished' ? record.lastPrompt.exitStatus : null;
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs hover:bg-accent"
        onClick={onClick}
        data-testid="fleet-result"
        data-session-id={sessionRef.sessionId}
      >
        <span className="flex-1 truncate font-medium">{record?.title ?? sessionRef.sessionId}</span>
        {pwd && <span className="truncate font-mono text-muted-foreground">{pwd}</span>}
        {exit !== null && (
          <Badge variant={exit === 0 ? 'secondary' : 'destructive'}>exit {exit}</Badge>
        )}
      </button>
    </li>
  );
}
