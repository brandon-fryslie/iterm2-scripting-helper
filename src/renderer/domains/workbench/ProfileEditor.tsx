import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

      {selected && <PropertyInspector properties={selected.properties} />}
    </div>
  );
});

// [LAW:one-source-of-truth] Read-only API view of the profile. iTerm2 Settings > Profiles is the
// canonical human editor of shared profiles; this surface exposes what that UI never shows — the
// exact property key strings and JSON value shapes the Python API and Dynamic Profiles consume.
// Values render verbatim as received from the API, so a copied value IS the literal argument.
const PropertyInspector = observer(function PropertyInspector({
  properties,
}: {
  properties: Record<string, string>;
}) {
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const needle = filter.trim().toLowerCase();
  const rows = Object.entries(properties)
    .filter(([key]) => key.toLowerCase().includes(needle))
    .sort(([a], [b]) => a.localeCompare(b));

  const copy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
  };

  return (
    <Card data-testid="profile-inspector">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Properties (API view)</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter keys…"
            data-testid="profile-inspector-filter"
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {rows.length} / {Object.keys(properties).length} keys
          </span>
        </div>
        <div className="grid gap-1">
          {rows.map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-[minmax(10rem,1fr)_2fr_auto] items-start gap-2 rounded border border-border/50 px-2 py-1"
              data-testid="profile-inspector-row"
              data-key={key}
            >
              <code className="break-all text-xs">{key}</code>
              <code className="break-all text-xs text-muted-foreground">{value}</code>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => void copy(`key:${key}`, key)}
                  data-testid="profile-inspector-copy-key"
                >
                  {copied === `key:${key}` ? 'copied' : 'key'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => void copy(`value:${key}`, value)}
                  data-testid="profile-inspector-copy-value"
                >
                  {copied === `value:${key}` ? 'copied' : 'value'}
                </Button>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No keys match the filter.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
