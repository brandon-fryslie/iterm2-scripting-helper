import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/stores/context';
import { evaluateTrigger, type TriggerTestResult } from '@shared/triggerRegex';

interface TriggerDict {
  regex?: string;
  action?: string;
  parameter?: unknown;
  partial?: boolean;
  disabled?: boolean;
  name?: string;
}

// [LAW:dataflow-not-control-flow] The tester always evaluates the same way; what varies is the
// value of `lines` — captured focused-session output or pasted text, selected as data.
type SampleSource = 'session' | 'pasted';

// Read-only by design (449.8.2): iTerm2 ships the canonical trigger editor, so this surface only
// shows what that editor never does — the raw Triggers JSON Dynamic Profile authors must
// hand-embed, and an engine-truthful dry run of which triggers would fire.
export const TriggersViewer = observer(function TriggersViewer() {
  const { workbench, monitor } = useStore();
  const [sample, setSample] = useState('');
  const [source, setSource] = useState<SampleSource>('session');
  const [copied, setCopied] = useState(false);

  const selected = workbench.selectedProfileGuid
    ? workbench.profiles.find((p) => p.guid === workbench.selectedProfileGuid)
    : null;

  let triggers: TriggerDict[] = [];
  let parseError: string | null = null;
  if (selected) {
    try {
      const raw = selected.properties['Triggers'];
      triggers = raw ? (JSON.parse(raw) as TriggerDict[]) : [];
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
  }

  const sessionLines = monitor.screen.lines.map((l) => l.text);
  const lines =
    source === 'session' ? sessionLines : sample === '' ? [] : sample.split('\n');

  const copyRawJson = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };

  return (
    <div className="grid gap-4" data-testid="workbench-triggers">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Triggers</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void workbench.refreshProfiles()}
            data-testid="triggers-refresh-profiles"
          >
            Refresh profiles
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Read-only view of the selected profile's Triggers array — edit triggers in
            iTerm2 (Settings &gt; Profiles &gt; Advanced). The dry run below shows which
            triggers would fire against captured or pasted output.
          </p>
          <Select
            value={workbench.selectedProfileGuid ?? ''}
            onValueChange={(v) => workbench.selectProfile(v || null)}
          >
            <SelectTrigger data-testid="triggers-profile-select">
              <SelectValue placeholder="Pick a profile…" />
            </SelectTrigger>
            <SelectContent>
              {workbench.profiles.map((p) => (
                <SelectItem key={p.guid} value={p.guid}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {parseError && <Badge variant="destructive">Parse error: {parseError}</Badge>}
        </CardContent>
      </Card>

      {selected && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Dry run</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <p className="text-xs text-amber-600" data-testid="triggers-engine-caveat">
                Engine caveat: this tester runs JavaScript RegExp; iTerm2 evaluates
                trigger regexes with the ICU engine. Patterns using constructs the two
                engines disagree on are flagged "cannot test" instead of being
                mis-evaluated.
              </p>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={source === 'session' ? 'default' : 'outline'}
                  onClick={() => setSource('session')}
                  data-testid="triggers-source-session"
                >
                  Focused session output
                </Button>
                <Button
                  size="sm"
                  variant={source === 'pasted' ? 'default' : 'outline'}
                  onClick={() => setSource('pasted')}
                  data-testid="triggers-source-pasted"
                >
                  Pasted text
                </Button>
              </div>
              {source === 'session' ? (
                <p className="text-xs text-muted-foreground" data-testid="triggers-session-info">
                  {monitor.screen.sessionId
                    ? `${sessionLines.length} captured line(s) from session ${monitor.screen.sessionId}`
                    : 'No focused session output captured — focus a session in the layout.'}
                </p>
              ) : (
                <Textarea
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                  rows={3}
                  className="font-mono text-xs"
                  placeholder="paste output — each trigger's regex runs against every line"
                  data-testid="triggers-sample"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {triggers.length} trigger(s) in {selected.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {triggers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No triggers on this profile.
                </p>
              ) : (
                <ul className="grid gap-2 text-xs">
                  {triggers.map((t, idx) => {
                    const result = evaluateTrigger(t.regex, lines);
                    return (
                      <li
                        key={idx}
                        className="rounded border p-2"
                        data-testid={`trigger-${idx}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={t.disabled ? 'outline' : 'default'}>
                            {t.action || '(no action)'}
                          </Badge>
                          {t.partial && <Badge variant="secondary">partial</Badge>}
                          {t.disabled && <Badge variant="outline">disabled</Badge>}
                          {t.name && <span className="font-mono">{t.name}</span>}
                          <TriggerResultBadge idx={idx} result={result} />
                        </div>
                        <div className="mt-1 font-mono text-muted-foreground break-all">
                          /{t.regex ?? ''}/
                        </div>
                        <TriggerResultDetail result={result} action={t.action} />
                        {t.parameter !== undefined && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-muted-foreground">
                              parameter
                            </summary>
                            <pre className="mt-1 whitespace-pre-wrap">
                              {JSON.stringify(t.parameter, null, 2)}
                            </pre>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Raw JSON</CardTitle>
              <div className="flex items-center gap-2">
                {copied && <Badge variant="secondary">copied</Badge>}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyRawJson(selected.properties['Triggers'] ?? '[]')}
                  data-testid="triggers-copy-json"
                >
                  Copy
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                This is the exact value of the profile's <code>Triggers</code> property —
                the JSON a Dynamic Profile embeds verbatim.
              </p>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                readOnly
                value={selected.properties['Triggers'] ?? '[]'}
                data-testid="triggers-raw"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
});

// [LAW:types-are-the-program] Exhaustive over TriggerTestResult — adding an outcome to the
// evaluator forces the renderer to say what it looks like; nothing falls through to silence.
function TriggerResultBadge({ idx, result }: { idx: number; result: TriggerTestResult }) {
  const common = { 'data-testid': `trigger-result-${idx}`, 'data-result': result.kind };
  switch (result.kind) {
    case 'fired':
      return (
        <Badge variant="default" {...common}>
          fires: {result.matched.slice(0, 24)}
        </Badge>
      );
    case 'no-match':
      return (
        <Badge variant="secondary" {...common}>
          no match
        </Badge>
      );
    case 'untestable':
      return (
        <Badge variant="destructive" {...common}>
          cannot test (ICU-only construct)
        </Badge>
      );
    case 'js-invalid':
      return (
        <Badge variant="destructive" {...common}>
          cannot test (not a valid JS regex)
        </Badge>
      );
    case 'no-input':
      return (
        <Badge variant="outline" {...common}>
          no sample
        </Badge>
      );
    case 'no-regex':
      return (
        <Badge variant="outline" {...common}>
          no regex
        </Badge>
      );
  }
}

function TriggerResultDetail({
  result,
  action,
}: {
  result: TriggerTestResult;
  action: string | undefined;
}) {
  switch (result.kind) {
    case 'fired':
      return (
        <p className="mt-1 text-[10px] text-muted-foreground">
          would run <code>{action ?? '(no action)'}</code> on line {result.lineIndex + 1}:{' '}
          <code className="break-all">{result.lineText.slice(0, 80)}</code>
        </p>
      );
    case 'untestable':
      return (
        <ul className="mt-1 list-disc pl-4 text-[10px] text-muted-foreground">
          {result.constructs.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      );
    case 'js-invalid':
      return (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {result.error} — the pattern may still be valid ICU; iTerm2 is the only honest
          judge here.
        </p>
      );
    case 'no-match':
    case 'no-input':
    case 'no-regex':
      return null;
  }
}
