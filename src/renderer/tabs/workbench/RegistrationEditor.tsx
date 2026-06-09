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
import type { RegistrationRole, KnobSpec } from '@shared/rpc';

const ROLES: Array<{ value: RegistrationRole; label: string }> = [
  { value: 'generic', label: 'Generic RPC' },
  { value: 'status-bar', label: 'Status Bar Component' },
  { value: 'session-title', label: 'Session Title' },
  { value: 'context-menu', label: 'Context Menu' },
];

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

          <Separator />
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void workbench.registerRpc()}
              data-testid="registration-register"
            >
              Register
            </Button>
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
                    <Badge variant="outline">{r.role}</Badge>
                    <span className="font-mono">{r.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => void workbench.unregisterRpc(r.id)}
                      data-testid={`registration-unregister-${r.id}`}
                    >
                      Unregister
                    </Button>
                  </div>
                  {r.statusBar && (
                    <div className="mt-1 text-muted-foreground">
                      id=<code>{r.statusBar.uniqueIdentifier}</code> ·{' '}
                      {r.statusBar.knobs.length} knob(s) · cadence{' '}
                      {r.statusBar.updateCadence}s
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
