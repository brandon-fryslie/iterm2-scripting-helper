import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';
import { cn } from '@/lib/utils';

const NEW_PROFILE_TEMPLATE = `{
  "Profiles": [
    {
      "Guid": "00000000-0000-0000-0000-000000000000",
      "Name": "My Dynamic Profile",
      "Dynamic Profile Parent Name": "Default"
    }
  ]
}
`;

export const DynamicProfileEditor = observer(function DynamicProfileEditor() {
  const { workbench } = useStore();
  const [newBasename, setNewBasename] = useState('my-profile.json');
  const snap = workbench.dynamicProfiles;

  return (
    <div className="grid gap-4 md:grid-cols-[240px_1fr]" data-testid="workbench-dynamic-profiles">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Folder</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-xs">
          <div className="break-all text-muted-foreground">{snap.folder}</div>
          <Badge variant={snap.folderExists ? 'default' : 'destructive'}>
            {snap.folderExists ? 'present' : 'missing'}
          </Badge>
          <div className="text-muted-foreground">{snap.files.length} file(s)</div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void workbench.refreshDynamicProfiles()}
          >
            Refresh
          </Button>
          <div className="mt-2">
            <div className="mb-1 font-medium">Files</div>
            <ul
              className="max-h-[40vh] space-y-1 overflow-auto"
              data-testid="dynamic-profiles-file-list"
            >
              {snap.files.map((f) => {
                const active = workbench.selectedDynamicProfileBasename === f.basename;
                return (
                  <li key={f.path}>
                    <button
                      onClick={() => workbench.selectDynamicProfile(f.basename)}
                      className={cn(
                        'w-full rounded px-2 py-1 text-left font-mono hover:bg-accent',
                        active && 'bg-accent font-semibold',
                      )}
                      data-testid={`dynamic-profile-file-${f.basename}`}
                    >
                      <div className="truncate">{f.basename}</div>
                      <div className="flex gap-1 text-[10px] text-muted-foreground">
                        {f.parseError ? (
                          <span className="text-destructive">parse error</span>
                        ) : (
                          <span>{f.profileCount} profile(s)</span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center gap-2">
          <CardTitle className="text-base">Editor</CardTitle>
          {workbench.dynamicEditorDirty && (
            <Badge variant="secondary">unsaved</Badge>
          )}
          {workbench.dynamicLastError && (
            <Badge variant="destructive" data-testid="dynamic-profiles-error">
              {workbench.dynamicLastError}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Input
              value={newBasename}
              onChange={(e) => setNewBasename(e.target.value)}
              className="max-w-[240px] font-mono text-xs"
              data-testid="dynamic-profile-new-name"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                workbench.selectDynamicProfile(null);
                workbench.setDynamicEditorBody(NEW_PROFILE_TEMPLATE);
              }}
            >
              New from template
            </Button>
            <Button
              size="sm"
              onClick={() => void workbench.saveDynamicProfile(newBasename)}
              data-testid="dynamic-profile-save"
            >
              Save as {newBasename}
            </Button>
            {workbench.selectedDynamicProfileBasename && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void workbench.saveDynamicProfile(
                    workbench.selectedDynamicProfileBasename ?? '',
                  )
                }
                data-testid="dynamic-profile-overwrite"
              >
                Overwrite {workbench.selectedDynamicProfileBasename}
              </Button>
            )}
            {workbench.selectedDynamicProfileBasename && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void workbench.deleteDynamicProfile(
                    workbench.selectedDynamicProfileBasename ?? '',
                  )
                }
              >
                Delete
              </Button>
            )}
          </div>
          <Textarea
            value={workbench.dynamicEditorBody}
            onChange={(e) => workbench.setDynamicEditorBody(e.target.value)}
            rows={20}
            className="font-mono text-xs"
            data-testid="dynamic-profile-editor-body"
            placeholder="Click a file on the left or 'New from template'."
          />
        </CardContent>
      </Card>
    </div>
  );
});
