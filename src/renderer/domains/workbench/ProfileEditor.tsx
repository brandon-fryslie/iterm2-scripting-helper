import { useState } from 'react';
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
import {
  PROFILE_CATEGORIES,
  fieldsByCategory,
  isDefaultValue,
  type ProfileCategory,
} from '@shared/profileSchema';
import { ProfileFieldControl } from './ProfileFieldControl';
import { ProfilePreview } from './ProfilePreview';

export const ProfileEditor = observer(function ProfileEditor() {
  const { workbench } = useStore();
  const [category, setCategory] = useState<ProfileCategory>('Colors');
  const selected = workbench.selectedProfileGuid
    ? workbench.profiles.find((p) => p.guid === workbench.selectedProfileGuid)
    : null;
  const changedCount = workbench.changedKeys.length;

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
              <code data-testid="workbench-selected-guid">{selected.guid}</code>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <>
          <ProfilePreview edit={workbench.profileEdit} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Edit</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-1" data-testid="profile-category-tabs">
                {PROFILE_CATEGORIES.map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant={category === c ? 'default' : 'outline'}
                    onClick={() => setCategory(c)}
                    data-testid={`profile-category-${c}`}
                  >
                    {c}
                  </Button>
                ))}
              </div>

              <div className="grid gap-2 text-sm">
                {fieldsByCategory(category).map((spec) => {
                  const value = workbench.profileEdit[spec.key] ?? spec.default;
                  const modified = !isDefaultValue(spec, value);
                  return (
                    <div
                      key={spec.key}
                      className="grid grid-cols-[11rem_1fr_auto] items-center gap-2"
                    >
                      <span
                        className="truncate text-muted-foreground"
                        title={spec.key}
                      >
                        {spec.label}
                      </span>
                      <ProfileFieldControl
                        spec={spec}
                        value={value}
                        onChange={(next) => workbench.updateField(spec.key, next)}
                      />
                      <button
                        type="button"
                        className={`text-[10px] ${modified ? 'text-amber-500 hover:underline' : 'invisible'}`}
                        onClick={() => workbench.updateField(spec.key, spec.default)}
                        title="Reset to iTerm2 default"
                        data-testid={`profile-reset-${spec.key}`}
                      >
                        ≠ default · reset
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 border-t pt-3">
                <Button
                  onClick={() => void workbench.applyProfileEdits()}
                  disabled={changedCount === 0}
                  data-testid="profile-edit-apply"
                >
                  Apply {changedCount > 0 ? `(${changedCount})` : ''} to profile
                </Button>
                {workbench.profileLastResult && (
                  <>
                    <Badge
                      variant={workbench.profileLastResult.ok ? 'default' : 'destructive'}
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Bulk apply</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p className="text-xs text-muted-foreground">
                Apply the {changedCount} pending change(s) to every profile whose name matches
                the filter.
              </p>
              <Input
                placeholder="Filter profiles by name (empty = all)"
                value={workbench.profileFilter}
                onChange={(e) => workbench.setProfileFilter(e.target.value)}
                data-testid="profile-bulk-filter"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={changedCount === 0 || workbench.filteredProfiles.length === 0}
                  onClick={() => void workbench.bulkApplyEdits()}
                  data-testid="profile-bulk-apply"
                >
                  Apply to {workbench.filteredProfiles.length} profile(s)
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
});
