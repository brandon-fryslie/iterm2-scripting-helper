import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/stores/context';
import { ESCAPE_TEMPLATES } from '@shared/escape-sequences';

function hexdump(s: string): string {
  const bytes = new TextEncoder().encode(s);
  const parts: string[] = [];
  for (const b of bytes) {
    parts.push(b.toString(16).padStart(2, '0'));
  }
  return parts.join(' ');
}

function humanize(s: string): string {
  return s
    .replace(/\x1b/g, 'ESC ')
    .replace(/\x07/g, 'BEL ')
    .replace(/\x5c/g, '\\\\');
}

export const EscapeSequenceEditor = observer(function EscapeSequenceEditor() {
  const { workbench, monitor } = useStore();
  const template = ESCAPE_TEMPLATES.find((t) => t.id === workbench.escapeTemplateId);
  const values = workbench.escapeTemplateValues[workbench.escapeTemplateId] ?? {};

  let sequence = '';
  let buildError: string | null = null;
  if (template) {
    try {
      const finalValues: Record<string, string> = {};
      for (const f of template.fields) {
        finalValues[f.name] = values[f.name] ?? f.default ?? '';
      }
      sequence = template.build(finalValues);
    } catch (err) {
      buildError = err instanceof Error ? err.message : String(err);
    }
  }

  const sessions: string[] = [];
  for (const w of monitor.layout.windows) {
    for (const t of w.tabs) {
      for (const s of t.sessions) sessions.push(s.sessionId);
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
            <SelectTrigger data-testid="escape-template-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESCAPE_TEMPLATES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.group} · {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {template && (
            <p className="text-xs text-muted-foreground">{template.description}</p>
          )}
          {template?.fields.map((f) => (
            <label key={f.name} className="grid grid-cols-[10rem_1fr] items-start gap-2">
              <span className="pt-1 text-xs text-muted-foreground">{f.name}</span>
              <div>
                {f.type === 'multiline' || f.type === 'file-base64' ? (
                  <textarea
                    value={values[f.name] ?? f.default ?? ''}
                    onChange={(e) =>
                      workbench.setEscapeField(template.id, f.name, e.target.value)
                    }
                    placeholder={f.placeholder}
                    rows={3}
                    className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
                    data-testid={`escape-field-${f.name}`}
                  />
                ) : f.type === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={(values[f.name] ?? f.default ?? 'false') === 'true'}
                    onChange={(e) =>
                      workbench.setEscapeField(
                        template.id,
                        f.name,
                        String(e.target.checked),
                      )
                    }
                  />
                ) : (
                  <Input
                    value={values[f.name] ?? f.default ?? ''}
                    onChange={(e) =>
                      workbench.setEscapeField(template.id, f.name, e.target.value)
                    }
                    placeholder={f.placeholder}
                    data-testid={`escape-field-${f.name}`}
                    type={f.type === 'number' ? 'number' : 'text'}
                  />
                )}
                {f.help && (
                  <p className="mt-1 text-[10px] text-muted-foreground">{f.help}</p>
                )}
              </div>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sequence</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {buildError ? (
            <Badge variant="destructive" data-testid="escape-build-error">
              {buildError}
            </Badge>
          ) : (
            <>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Readable</div>
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
                  <SelectItem key={s} value={s}>
                    {s.slice(0, 12)}…
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={async () => {
                if (!sequence || !workbench.escapeTemplateTarget) return;
                const result = await window.ipc.invoke('actions/send-text', {
                  sessionId: workbench.escapeTemplateTarget,
                  text: sequence,
                });
                workbench.recordEscape(sequence, result);
              }}
              disabled={!sequence || !workbench.escapeTemplateTarget}
              data-testid="escape-emit"
            >
              Emit to session
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!sequence) return;
                void navigator.clipboard.writeText(sequence);
              }}
              disabled={!sequence}
              data-testid="escape-copy"
            >
              Copy
            </Button>
            {workbench.escapeLastSent?.result && (
              <Badge
                variant={workbench.escapeLastSent.result.ok ? 'default' : 'destructive'}
                data-testid="escape-emit-result"
              >
                {workbench.escapeLastSent.result.ok
                  ? `emitted (${workbench.escapeLastSent.result.latencyMs} ms)`
                  : `error: ${workbench.escapeLastSent.result.error}`}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
