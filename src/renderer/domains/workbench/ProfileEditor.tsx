import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const ProfileEditor = observer(function ProfileEditor() {
  const { workbench } = useStore();
  const selected = workbench.selectedProfileGuid
    ? workbench.profiles.find((p) => p.guid === workbench.selectedProfileGuid)
    : null;

  return (
    <div className="grid gap-4" data-testid="workbench-profile-editor">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Profiles</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {workbench.profiles.length} profile(s)
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void workbench.refreshProfiles()}
              data-testid="workbench-refresh-profiles"
            >
              Refresh
            </Button>
          </div>
          <Select
            value={workbench.selectedProfileGuid ?? ''}
            onValueChange={(v) => workbench.selectProfile(v || null)}
          >
            <SelectTrigger data-testid="workbench-profile-select">
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
          {selected && (
            <div className="text-xs text-muted-foreground">
              <code>{selected.guid}</code>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Edit</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <Field label="Name">
              <Input
                value={workbench.profileEdit.name}
                onChange={(e) => workbench.updateEdit({ name: e.target.value })}
                data-testid="profile-edit-name"
              />
            </Field>
            <Field label="Background">
              <ColorInput
                value={workbench.profileEdit.backgroundHex}
                onChange={(v) => workbench.updateEdit({ backgroundHex: v })}
                testId="profile-edit-bg"
              />
            </Field>
            <Field label="Foreground">
              <ColorInput
                value={workbench.profileEdit.foregroundHex}
                onChange={(v) => workbench.updateEdit({ foregroundHex: v })}
                testId="profile-edit-fg"
              />
            </Field>
            <Field label="Badge text">
              <Input
                value={workbench.profileEdit.badgeText}
                onChange={(e) => workbench.updateEdit({ badgeText: e.target.value })}
                data-testid="profile-edit-badge"
              />
            </Field>
            <Field label="Transparency">
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={workbench.profileEdit.transparency}
                onChange={(e) =>
                  workbench.updateEdit({ transparency: e.target.value })
                }
              />
            </Field>
            <Field label="Use transparency">
              <input
                type="checkbox"
                checked={workbench.profileEdit.useTransparency}
                onChange={(e) =>
                  workbench.updateEdit({ useTransparency: e.target.checked })
                }
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => void workbench.applyProfileEdits()}
                data-testid="profile-edit-apply"
              >
                Apply to profile
              </Button>
              {workbench.profileLastResult && (
                <>
                  <Badge
                    variant={
                      workbench.profileLastResult.ok ? 'default' : 'destructive'
                    }
                    data-testid="profile-edit-result"
                  >
                    {workbench.profileLastResult.ok ? 'applied' : 'error'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {workbench.profileLastResult.latencyMs} ms
                  </span>
                  {workbench.profileLastResult.error && (
                    <span className="text-xs text-destructive">
                      {workbench.profileLastResult.error}
                    </span>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[8rem_1fr] items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div>{children}</div>
    </label>
  );
}

function ColorInput({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-12 cursor-pointer"
        data-testid={testId}
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[120px] font-mono text-xs"
      />
    </div>
  );
}
