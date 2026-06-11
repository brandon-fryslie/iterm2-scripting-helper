import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/stores/context';
import { ExpressionProbe } from '@/components/ExpressionProbe';
import { CustomEscapeSubscriber } from './CustomEscapeSubscriber';
import { flatSessions, sessionEntityRef } from '@shared/domain';
import type { AppEntitySessionRef } from '@shared/domain';
import { ESCAPE_TEMPLATES, effectiveValues, renderTemplate } from '@shared/escape-sequences';
import type { EscapeTemplate, TemplateField } from '@shared/escape-sequences';

const TEMPLATE_GROUPS: ReadonlyArray<{ group: EscapeTemplate['group']; label: string }> = [
  { group: 'osc-1337', label: 'OSC 1337 (iTerm2 proprietary)' },
  { group: 'osc-133', label: 'OSC 133 (FinalTerm shell integration)' },
  { group: 'osc-8', label: 'OSC 8 (hyperlinks)' },
  { group: 'csi', label: 'CSI (SGR / cursor)' },
];

export const EscapeSequenceEditor = observer(function EscapeSequenceEditor() {
  const { workbench, monitor, entityFocus } = useStore();

  const template: EscapeTemplate | undefined = ESCAPE_TEMPLATES.find((t: EscapeTemplate) => t.id === workbench.escapeTemplateId);
  const values = workbench.escapeTemplateValues[workbench.escapeTemplateId] ?? {};
  const fields = template?.fields ?? [];
  const display = template ? effectiveValues(template, values) : {};
  // Incomplete input is a value ({ok:false}), never an exception escaping into render.
  const built = template ? renderTemplate(template, values) : null;
  const sequence = built?.ok ? built.sequence : '';

  const sessions: Array<{ sessionId: string; title: string; ref: AppEntitySessionRef }> = [];
  for (const w of monitor.layout.windows) {
    for (const t of w.tabs) {
      for (const s of flatSessions(t)) {
        sessions.push({ sessionId: s.sessionId, title: s.title, ref: sessionEntityRef(w, t, s) });
      }
    }
  }

  // [LAW:one-source-of-truth] The editor acts on the focused session by default; the picker is
  // an explicit override layered on top (empty = follow focus), never a second authority for
  // "which entity". The full ref is resolved from the layout so emitted events carry real
  // window/tab provenance, not a synthesized partial.
  const targetId = workbench.escapeTemplateTarget || entityFocus.sessionId || '';
  const targetRef = sessions.find((s) => s.sessionId === targetId)?.ref ?? null;
  const usingFocus = workbench.escapeTemplateTarget === '';
  const targetTitle = sessions.find((s) => s.sessionId === targetId)?.title;

  return (
    <div className="grid gap-4" data-testid="workbench-escape-editor">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Template</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <Select
            value={workbench.escapeTemplateId}
            onValueChange={(v) => workbench.setEscapeTemplate(v)}
          >
            <SelectTrigger data-testid="escape-template-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_GROUPS.map(({ group, label }) => (
                <SelectGroup key={group}>
                  <SelectLabel>{label}</SelectLabel>
                  {ESCAPE_TEMPLATES.filter((t: EscapeTemplate) => t.group === group).map((t) => (
                    <SelectItem key={t.id} value={t.id} data-testid={`escape-template-${t.id}`}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {template?.description && (
            <p className="text-xs text-muted-foreground">{template.description}</p>
          )}
          {fields.map((f: TemplateField) => (
            <label key={f.name} className="grid grid-cols-[8rem_1fr] items-start gap-2">
              <span className="pt-2 text-xs text-muted-foreground">
                {f.name}
                {f.help && <span className="mt-0.5 block text-[10px] opacity-70">{f.help}</span>}
              </span>
              <EscapeFieldInput
                field={f}
                value={display[f.name] ?? ''}
                onChange={(value) =>
                  workbench.setEscapeField(workbench.escapeTemplateId, f.name, value)
                }
              />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Preview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {sequence ? (
            <>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Human-readable</div>
                <pre
                  className="whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs"
                  data-testid="escape-sequence-readable"
                >
                  {humanize(sequence)}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Hex</div>
                <pre
                  className="whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs"
                  data-testid="escape-sequence-hex"
                >
                  {hexdump(sequence)}
                </pre>
              </div>
            </>
          ) : built && !built.ok ? (
            <p className="text-xs text-destructive" data-testid="escape-build-error">
              {built.error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Select a template above.</p>
          )}
          <div
            className="text-xs text-muted-foreground"
            data-testid="escape-effective-target"
            data-target={targetId || 'none'}
          >
            {targetRef ? (
              <>
                Emitting to{' '}
                <span className="font-mono text-foreground">
                  {targetTitle || targetId.slice(0, 12) + '…'}
                </span>{' '}
                {usingFocus ? '(focused session)' : '(override)'}
              </>
            ) : (
              'No target session — focus a session or override below.'
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={workbench.escapeTemplateTarget || '__focus__'}
              onValueChange={(v) => workbench.setEscapeTarget(v === '__focus__' ? '' : v)}
            >
              <SelectTrigger className="max-w-[300px]" data-testid="escape-target-select">
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
            <Button
              onClick={async () => {
                if (!sequence || !targetRef) return;
                // Escape sequences are a terminal-*output* protocol: inject delivers the bytes as
                // though the session's process emitted them. send-text would hand them to the
                // shell as typed input, where they are echoed in caret notation, not interpreted.
                const result = await window.ipc.invoke('actions/inject', {
                  entity: targetRef,
                  sessionIds: [targetRef.sessionId],
                  bytesHex: toHex(sequence),
                });
                workbench.recordEscape(sequence, result);
              }}
              disabled={!sequence || !targetRef}
              data-testid="escape-send"
            >
              Emit to session
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!sequence) return;
                await navigator.clipboard.writeText(sequence);
                workbench.recordEscapeCopy(sequence);
              }}
              disabled={!sequence}
              data-testid="escape-copy"
            >
              Copy to clipboard
            </Button>
            {workbench.escapeLastSent && (
              <span
                className="text-xs text-muted-foreground"
                data-testid="escape-last-result"
                data-ok={workbench.escapeLastSent.result.ok ? 'true' : 'false'}
              >
                last: {workbench.escapeLastSent.result.ok ? 'ok' : workbench.escapeLastSent.result.error}
              </span>
            )}
            {workbench.escapeLastCopied && (
              <span className="text-xs text-muted-foreground" data-testid="escape-copied">
                copied {workbench.escapeLastCopied.length} chars
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* OSC 1337 Custom= is a paired protocol: the emitter and its
          CustomControlSequenceMonitor subscriber are one workflow, so the subscriber renders
          here — bound to the same target and the template's identity — not on a separate
          surface. [LAW:decomposition] */}
      {template?.id === 'osc1337-custom' && (
        <CustomEscapeSubscriber
          targetId={targetId}
          targetLabel={targetTitle || targetId.slice(0, 12) + '…'}
          identity={display['identity'] ?? ''}
        />
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resolve a variable against focus</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 p-0 text-sm">
          <p className="px-3 pt-3 text-xs text-muted-foreground">
            Evaluate a path against the focused entity to find the literal value to paste into a
            template field — e.g. <code>session.name</code> or <code>{'\\(user.foo)'}</code>.
          </p>
          <ExpressionProbe />
        </CardContent>
      </Card>
    </div>
  );
});

function EscapeFieldInput({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === 'select') {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={`escape-field-${field.name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (field.type === 'multiline' || field.type === 'file-base64') {
    return (
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className="min-h-16 font-mono text-xs"
        data-testid={`escape-field-${field.name}`}
      />
    );
  }
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      data-testid={`escape-field-${field.name}`}
    />
  );
}

function humanize(s: string): string {
  return s
    .replace(/\x1b/g, '\\e')
    .replace(/\x07/g, '\\a')
    .replace(/\x00/g, '\\0');
}

// [LAW:one-source-of-truth] The hex shown in the preview and the hex sent over inject are the
// same UTF-8 byte derivation; charCodeAt would report UTF-16 code units, not wire bytes.
function utf8Hex(s: string): string[] {
  return Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0'));
}

function toHex(s: string): string {
  return utf8Hex(s).join('');
}

function hexdump(s: string): string {
  return utf8Hex(s).join(' ');
}
