import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/stores/context';
import { ExpressionProbe } from '@/components/ExpressionProbe';
import { flatSessions, sessionEntityRef } from '@shared/domain';
import type { AppEntitySessionRef } from '@shared/domain';
import { ESCAPE_TEMPLATES } from '@shared/escape-sequences';
import type { EscapeTemplate } from '@shared/escape-sequences';

export const EscapeSequenceEditor = observer(function EscapeSequenceEditor() {
  const { workbench, monitor, entityFocus } = useStore();

  useEffect(() => {
    void workbench.refreshCustomEscape();
  }, [workbench]);

  const template: EscapeTemplate | undefined = ESCAPE_TEMPLATES.find((t: EscapeTemplate) => t.id === workbench.escapeTemplateId);
  const fields = template?.fields ?? [];
  const values = workbench.escapeTemplateValues[workbench.escapeTemplateId] ?? {};
  let sequence = '';
  if (template) {
    sequence = template.build(values);
  }

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
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESCAPE_TEMPLATES.map((t: EscapeTemplate) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {template?.description && (
            <p className="text-xs text-muted-foreground">{template.description}</p>
          )}
          {fields.map((f: { name: string; placeholder?: string; default?: string }) => (
            <label key={f.name} className="grid grid-cols-[8rem_1fr] items-center gap-2">
              <span className="text-xs text-muted-foreground">{f.name}</span>
              <Input
                value={values[f.name] ?? f.default}
                onChange={(e) =>
                  workbench.setEscapeField(workbench.escapeTemplateId, f.name, e.target.value)
                }
                placeholder={f.placeholder}
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
                const result = await window.ipc.invoke('actions/send-text', {
                  entity: targetRef,
                  sessionId: targetRef.sessionId,
                  text: sequence,
                  suppressBroadcast: true,
                });
                workbench.recordEscape(sequence, result);
              }}
              disabled={!sequence || !targetRef}
              data-testid="escape-send"
            >
              Emit to session
            </Button>
            {workbench.escapeLastSent && (
              <span className="text-xs text-muted-foreground">
                last: {workbench.escapeLastSent.result.ok ? 'ok' : workbench.escapeLastSent.result.error}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

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

function humanize(s: string): string {
  return s
    .replace(/\x1b/g, '\\e')
    .replace(/\x07/g, '\\a')
    .replace(/\x00/g, '\\0');
}

function hexdump(s: string): string {
  return Array.from(s)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join(' ');
}
