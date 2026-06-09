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
import { flatSessions } from '@shared/domain';
import { ESCAPE_TEMPLATES } from '@shared/escape-sequences';
import type { EscapeTemplate } from '@shared/escape-sequences';

export const EscapeSequenceEditor = observer(function EscapeSequenceEditor() {
  const { workbench, monitor } = useStore();

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

  const sessions: Array<{ sessionId: string; title: string }> = [];
  for (const w of monitor.layout.windows) {
    for (const t of w.tabs) {
      for (const s of flatSessions(t)) sessions.push({ sessionId: s.sessionId, title: s.title });
    }
  }

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
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={workbench.escapeTemplateTarget}
              onValueChange={(v) => workbench.setEscapeTarget(v)}
            >
              <SelectTrigger className="max-w-[300px]" data-testid="escape-target-select">
                <SelectValue placeholder="Pick a target session…" />
              </SelectTrigger>
              <SelectContent>
                {sessions.map((s) => (
                  <SelectItem key={s.sessionId} value={s.sessionId}>
                    {s.title || s.sessionId.slice(0, 12) + '…'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={async () => {
                if (!sequence) return;
                const result = await window.ipc.invoke('actions/send-text', {
                  // Scoped to the session this editor targets; window/tab unknown from a session id
                  // alone, matching the spine's session-entity convention.
                  entity: {
                    kind: 'session',
                    windowId: '',
                    tabId: '',
                    sessionId: workbench.escapeTemplateTarget,
                  },
                  sessionId: workbench.escapeTemplateTarget,
                  text: sequence,
                  suppressBroadcast: true,
                });
                workbench.recordEscape(sequence, result);
              }}
              disabled={!sequence || !workbench.escapeTemplateTarget}
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
