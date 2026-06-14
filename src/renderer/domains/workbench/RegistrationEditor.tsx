import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
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
import {
  ROLE_CAPABILITIES,
  registrationDisplayName,
  type RegistrationRole,
  type KnobSpec,
} from '@shared/rpc';

// [LAW:one-source-of-truth] The role list, labels, and per-role capabilities all come from the one
// catalog in shared/rpc.ts — adding a role there is the only step that grows this editor.
const ROLES = Object.entries(ROLE_CAPABILITIES).map(([value, caps]) => ({
  value: value as RegistrationRole,
  label: caps.label,
}));

const KNOB_TYPES: Array<KnobSpec['type']> = [
  'Checkbox',
  'String',
  'PositiveFloatingPoint',
  'Color',
];

const DEFAULT_KNOB: KnobSpec = {
  name: 'colorKnob',
  type: 'Color',
  placeholder: 'Pick a color',
  jsonDefaultValue: JSON.stringify({
    'Red Component': 0.2,
    'Green Component': 0.6,
    'Blue Component': 1,
    'Alpha Component': 1,
    'Color Space': 'sRGB',
  }),
  key: 'color',
};

export const RegistrationEditor = observer(function RegistrationEditor() {
  const { workbench } = useStore();

  useEffect(() => {
    void workbench.refreshRegistrations();
    const unsub = window.ipc.on('registrations-snapshot', (s) =>
      workbench.applyRegistrationsSnapshot(s),
    );
    return () => unsub();
  }, [workbench]);

  const form = workbench.registrationForm;

  return (
    <div className="grid gap-4" data-testid="workbench-registrations">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">New registration</CardTitle>
          <Badge variant="outline">
            {workbench.registrationsSnapshot.registrations.length} active
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <label className="grid grid-cols-[10rem_1fr] items-center gap-2 text-xs">
            <span className="text-muted-foreground">Role</span>
            <Select
              value={form.role}
              onValueChange={(v) =>
                workbench.updateRegistrationForm({ role: v as RegistrationRole })
              }
            >
              <SelectTrigger data-testid="registration-role-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {form.role !== 'toolbelt' && (
            <>
              <Field label="Function name">
                <Input
                  value={form.name}
                  onChange={(e) => workbench.updateRegistrationForm({ name: e.target.value })}
                  placeholder="my_rpc"
                  data-testid="registration-name"
                />
              </Field>
              <Field label="Args (csv)">
                <Input
                  value={form.argumentsCsv}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({ argumentsCsv: e.target.value })
                  }
                  placeholder="session_id, cadence"
                />
              </Field>
              <Field label="Timeout (s)">
                <Input
                  type="number"
                  value={form.timeout}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({ timeout: Number(e.target.value) || 0 })
                  }
                />
              </Field>
              <Field label="Response JSON">
                <Textarea
                  rows={3}
                  className="font-mono text-xs"
                  value={form.responseTemplate}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({ responseTemplate: e.target.value })
                  }
                  data-testid="registration-response"
                />
              </Field>
            </>
          )}

          {form.role === 'status-bar' && (
            <>
              <Separator />
              <div className="text-xs text-muted-foreground">Status bar attributes</div>
              <Field label="Short description">
                <Input
                  value={form.statusBarShortDescription}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({
                      statusBarShortDescription: e.target.value,
                    })
                  }
                  data-testid="status-bar-short-desc"
                />
              </Field>
              <Field label="Detailed description">
                <Input
                  value={form.statusBarDetailedDescription}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({
                      statusBarDetailedDescription: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Exemplar">
                <Input
                  value={form.statusBarExemplar}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({ statusBarExemplar: e.target.value })
                  }
                  placeholder="demo text shown in picker"
                />
              </Field>
              <Field label="Update cadence (s)">
                <Input
                  type="number"
                  value={form.statusBarCadence}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({
                      statusBarCadence: Number(e.target.value) || 0,
                    })
                  }
                />
              </Field>
              <Field label="Unique identifier">
                <Input
                  value={form.statusBarUniqueIdentifier}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({
                      statusBarUniqueIdentifier: e.target.value,
                    })
                  }
                  placeholder="com.example.my-component"
                  data-testid="status-bar-unique-id"
                />
              </Field>
              <Field label="Knobs">
                <div className="grid gap-2">
                  {form.statusBarKnobs.map((k, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1"
                      data-testid={`knob-row-${idx}`}
                    >
                      <Input
                        value={k.name}
                        onChange={(e) =>
                          workbench.updateKnob(idx, { name: e.target.value })
                        }
                        placeholder="name"
                      />
                      <Select
                        value={k.type}
                        onValueChange={(v) =>
                          workbench.updateKnob(idx, { type: v as KnobSpec['type'] })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {KNOB_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={k.key}
                        onChange={(e) =>
                          workbench.updateKnob(idx, { key: e.target.value })
                        }
                        placeholder="key"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => workbench.removeKnob(idx)}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => workbench.addKnob({ ...DEFAULT_KNOB })}
                    data-testid="knob-add"
                  >
                    + Add knob
                  </Button>
                </div>
              </Field>
            </>
          )}

          {(form.role === 'session-title' || form.role === 'context-menu') && (
            <>
              <Separator />
              <Field label="Display name">
                <Input
                  value={form.displayName}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({ displayName: e.target.value })
                  }
                />
              </Field>
              <Field label="Unique identifier">
                <Input
                  value={form.uniqueIdentifier}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({
                      uniqueIdentifier: e.target.value,
                    })
                  }
                  placeholder="com.example.my-component"
                />
              </Field>
            </>
          )}

          {form.role === 'toolbelt' && (
            <>
              <Separator />
              <div className="text-xs text-muted-foreground">
                Webview tool shown in the iTerm2 toolbelt. Tools persist in iTerm2 until it
                restarts; re-registering the same identifier updates it in place.
              </div>
              <Field label="Display name">
                <Input
                  value={form.toolbeltDisplayName}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({ toolbeltDisplayName: e.target.value })
                  }
                  data-testid="toolbelt-display-name"
                />
              </Field>
              <Field label="Identifier">
                <Input
                  value={form.toolbeltIdentifier}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({ toolbeltIdentifier: e.target.value })
                  }
                  placeholder="com.example.my-tool"
                  data-testid="toolbelt-identifier"
                />
              </Field>
              <Field label="URL">
                <Input
                  value={form.toolbeltUrl}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({ toolbeltUrl: e.target.value })
                  }
                  placeholder="https://example.com"
                  data-testid="toolbelt-url"
                />
              </Field>
              <Field label="Reveal if registered">
                <input
                  type="checkbox"
                  checked={form.toolbeltReveal}
                  onChange={(e) =>
                    workbench.updateRegistrationForm({ toolbeltReveal: e.target.checked })
                  }
                />
              </Field>
            </>
          )}

          <Separator />
          <Field label="Preview">
            <pre
              className="max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[10px]"
              data-testid="registration-preview"
            >
              {JSON.stringify(workbench.registrationDraft, null, 2)}
            </pre>
          </Field>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void workbench.registerRpc()}
              data-testid="registration-register"
            >
              Install
            </Button>
            {form.role !== 'toolbelt' && (
              <Button
                variant="outline"
                onClick={() => {
                  // The draft's role mirrors the form's; narrow off toolbelt so the store method only
                  // ever receives an RpcRegistrationBody.
                  const draft = workbench.registrationDraft;
                  if (draft.role !== 'toolbelt') void workbench.exportPythonStub(draft);
                }}
                data-testid="registration-export-python"
                title="Save a runnable iTerm2 Python stub for the Scripts folder"
              >
                Export .py
              </Button>
            )}
            {workbench.registrationLastResult && (
              <Badge
                variant={
                  workbench.registrationLastResult.ok ? 'default' : 'destructive'
                }
                data-testid="registration-result"
              >
                {workbench.registrationLastResult.ok
                  ? 'registered'
                  : workbench.registrationLastResult.error ?? 'error'}
              </Badge>
            )}
            {/* [LAW:no-silent-failure] A real failure speaks; a user-cancelled dialog (error null) is
                a deliberate no-op with no badge. */}
            {workbench.pythonExportResult &&
              (workbench.pythonExportResult.ok ? (
                <Badge variant="default" data-testid="registration-export-result">
                  exported
                </Badge>
              ) : (
                workbench.pythonExportResult.error !== null && (
                  <Badge variant="destructive" data-testid="registration-export-result">
                    {workbench.pythonExportResult.error}
                  </Badge>
                )
              ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Active registrations</CardTitle>
          <span className="text-xs text-muted-foreground">
            {workbench.registrationsSnapshot.totalInvocations} invocation(s) seen ·
            in the Activity timeline
          </span>
        </CardHeader>
        <CardContent>
          {workbench.registrationsSnapshot.registrations.length === 0 ? (
            <p className="text-xs text-muted-foreground">None registered yet.</p>
          ) : (
            <ul className="grid gap-2 text-xs">
              {workbench.registrationsSnapshot.registrations.map((r) => (
                <li
                  key={r.id}
                  className="rounded border p-2"
                  data-testid={`registration-${r.id}`}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{ROLE_CAPABILITIES[r.role].label}</Badge>
                    <span className="font-mono">{registrationDisplayName(r)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => void workbench.unregisterRpc(r.id)}
                      data-testid={`registration-unregister-${r.id}`}
                      title={
                        ROLE_CAPABILITIES[r.role].wireUnregister
                          ? undefined
                          : 'iTerm2 has no unregister for tools; this forgets it locally and iTerm2 keeps it until restart'
                      }
                    >
                      {ROLE_CAPABILITIES[r.role].wireUnregister ? 'Unregister' : 'Forget'}
                    </Button>
                  </div>
                  {r.role === 'status-bar' && (
                    <div className="mt-1 text-muted-foreground">
                      id=<code>{r.attrs.uniqueIdentifier}</code> ·{' '}
                      {r.attrs.knobs.length} knob(s) · cadence{' '}
                      {r.attrs.updateCadence}s
                    </div>
                  )}
                  {(r.role === 'session-title' || r.role === 'context-menu') && (
                    <div className="mt-1 text-muted-foreground">
                      id=<code>{r.attrs.uniqueIdentifier}</code>
                    </div>
                  )}
                  {r.role === 'toolbelt' && (
                    <div className="mt-1 text-muted-foreground">
                      id=<code>{r.attrs.identifier}</code> · {r.attrs.url} · persists in
                      iTerm2 until restart
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[10rem_1fr] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div>{children}</div>
    </label>
  );
}
