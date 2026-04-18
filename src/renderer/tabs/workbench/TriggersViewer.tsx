import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/stores/context';

interface TriggerDict {
  regex?: string;
  action?: string;
  parameter?: unknown;
  partial?: boolean;
  disabled?: boolean;
  name?: string;
}

export const TriggersViewer = observer(function TriggersViewer() {
  const { workbench } = useStore();
  const [sample, setSample] = useState('');

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

  return (
    <div className="grid gap-4" data-testid="workbench-triggers">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Triggers</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void workbench.refreshProfiles()}
          >
            Refresh profiles
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Read-only view of the selected profile's Triggers array. Matches are live
            against the Regex tester below — paste a snippet of captured output to see
            which triggers would fire.
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
              <CardTitle className="text-base">Regex sample</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                rows={3}
                className="font-mono text-xs"
                placeholder="paste captured output — each trigger's regex runs against every line"
                data-testid="triggers-sample"
              />
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
                    const match = matchAgainst(t.regex, sample);
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
                          {match && (
                            <Badge variant="default" data-testid={`trigger-match-${idx}`}>
                              match: {match.slice(0, 24)}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 font-mono text-muted-foreground break-all">
                          /{t.regex ?? ''}/
                        </div>
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
                        <Separator className="my-2" />
                        <SendPayloadHint trigger={t} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Raw JSON</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                readOnly
                value={selected.properties['Triggers'] ?? '[]'}
                data-testid="triggers-raw"
              />
              <Input
                className="mt-2 max-w-[360px] font-mono"
                placeholder="Replacement JSON (to apply)"
                value={workbench.triggersDraft}
                onChange={(e) => workbench.setTriggersDraft(e.target.value)}
              />
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void workbench.applyTriggersDraft()}
                  disabled={!workbench.triggersDraft}
                  data-testid="triggers-apply"
                >
                  Apply to profile
                </Button>
                {workbench.triggersLastResult && (
                  <Badge
                    variant={workbench.triggersLastResult.ok ? 'default' : 'destructive'}
                  >
                    {workbench.triggersLastResult.ok
                      ? 'applied'
                      : workbench.triggersLastResult.error ?? 'error'}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
});

function matchAgainst(regex: string | undefined, text: string): string | null {
  if (!regex || !text) return null;
  try {
    const re = new RegExp(regex);
    const m = re.exec(text);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

function SendPayloadHint({ trigger }: { trigger: TriggerDict }) {
  if (!trigger.action) return null;
  return (
    <p className="text-[10px] text-muted-foreground">
      action <code>{trigger.action}</code> fires when the regex matches a line of
      terminal output.
    </p>
  );
}
