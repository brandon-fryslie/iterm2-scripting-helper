import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';
import { cn } from '@/lib/utils';
import {
  resolveParent,
  type DynamicProfileAnalysis,
  type ParentCandidate,
  type ProfileEntry,
} from '@shared/dynamicProfiles';
import type { DynamicSyncStatus } from '@/stores/WorkbenchStore';

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

const WARN_TEXT = 'text-amber-700 dark:text-amber-400';

function fileBadge(analysis: DynamicProfileAnalysis): {
  label: string;
  variant: 'secondary' | 'destructive' | 'outline';
} {
  switch (analysis.kind) {
    case 'profiles':
      return { label: `${analysis.entries.length} profile(s)`, variant: 'secondary' };
    case 'json-error':
      return { label: 'JSON error', variant: 'destructive' };
    case 'shape-error':
      return { label: 'shape error', variant: 'destructive' };
    case 'empty':
      return { label: 'empty', variant: 'destructive' };
    case 'plist':
      return { label: 'plist', variant: 'outline' };
  }
}

const SYNC_BADGE: Record<
  Exclude<DynamicSyncStatus, 'idle'>,
  { label: string; variant: 'secondary' | 'destructive' | 'outline' }
> = {
  draft: { label: 'draft — not on disk', variant: 'secondary' },
  synced: { label: 'synced with disk', variant: 'outline' },
  dirty: { label: 'unsaved changes', variant: 'secondary' },
  conflict: { label: 'changed on disk', variant: 'destructive' },
  deleted: { label: 'deleted on disk', variant: 'destructive' },
};

function ParentLine({
  entry,
  candidates,
}: {
  entry: ProfileEntry;
  candidates: ParentCandidate[];
}) {
  const res = resolveParent(entry.parent, candidates);
  switch (res.state) {
    case 'none':
      return <div className="text-muted-foreground">no parent (inherits defaults)</div>;
    case 'resolved':
      return (
        <div data-testid="parent-resolved">
          parent by {res.ref.by} &ldquo;{res.ref.value}&rdquo; &rarr;{' '}
          <span className="font-medium">{res.target.name}</span>{' '}
          <span className="text-muted-foreground">({res.target.source})</span>
        </div>
      );
    case 'fallback-default':
      return (
        <div className={WARN_TEXT} data-testid="parent-fallback">
          parent by {res.ref.by} &ldquo;{res.ref.value}&rdquo; not found &mdash; iTerm2 will use
          the default profile
        </div>
      );
  }
}

const AnalysisPanel = observer(function AnalysisPanel() {
  const { workbench } = useStore();
  const analysis = workbench.dynamicEditorAnalysis;
  if (!analysis) return null;

  switch (analysis.kind) {
    case 'empty':
      return (
        <div className="text-xs text-destructive" data-testid="dynamic-analysis-empty">
          Empty file &mdash; iTerm2 treats it as malformed and ignores the entire DynamicProfiles
          folder while it exists on disk.
        </div>
      );
    case 'plist':
      return (
        <div className="text-xs text-muted-foreground" data-testid="dynamic-analysis-plist">
          Property list (XML/binary) &mdash; iTerm2 accepts this format, but this editor only
          validates JSON.
        </div>
      );
    case 'json-error':
      return (
        <div className="text-xs text-destructive" data-testid="dynamic-analysis-json-error">
          <div className="font-medium">Invalid JSON: {analysis.message}</div>
          <div>
            iTerm2 ignores the entire DynamicProfiles folder while a malformed file is present.
          </div>
        </div>
      );
    case 'shape-error':
      return (
        <div className="text-xs text-destructive" data-testid="dynamic-analysis-shape-error">
          Invalid dynamic profile shape: {analysis.message}
        </div>
      );
    case 'profiles': {
      const candidates = workbench.dynamicParentCandidates;
      return (
        <div className="grid gap-2 text-xs" data-testid="dynamic-analysis-profiles">
          {analysis.entries.length === 0 && (
            <div className="text-muted-foreground">&ldquo;Profiles&rdquo; is empty.</div>
          )}
          {analysis.entries.map((entry) => (
            <div
              key={entry.index}
              className="rounded border p-2"
              data-testid={`dynamic-profile-entry-${entry.index}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{entry.name ?? '(no name)'}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {entry.guid ?? '(no guid)'}
                </span>
              </div>
              {entry.issues.map((issue) => (
                <div key={issue} className="text-destructive">
                  {issue}
                </div>
              ))}
              <ParentLine entry={entry} candidates={candidates} />
            </div>
          ))}
        </div>
      );
    }
  }
});

export const DynamicProfileEditor = observer(function DynamicProfileEditor() {
  const { workbench } = useStore();
  const [newBasename, setNewBasename] = useState('my-profile.json');
  const snap = workbench.dynamicProfiles;
  const analyses = new Map(
    workbench.dynamicFileAnalyses.map((f) => [f.basename, f.analysis]),
  );
  const blockers = workbench.dynamicFolderBlockers;
  const sync = workbench.dynamicSyncStatus;
  const saveBlocked = workbench.dynamicSaveBlocked;

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
          {blockers.length > 0 && (
            <div
              className="rounded border border-destructive/50 bg-destructive/10 p-2 text-destructive"
              data-testid="dynamic-folder-blockers"
            >
              iTerm2 is ignoring ALL dynamic profile changes: malformed{' '}
              {blockers.join(', ')}
            </div>
          )}
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
                const analysis = analyses.get(f.basename);
                const badge = analysis ? fileBadge(analysis) : null;
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
                      {badge && (
                        <div
                          className={cn(
                            'text-[10px]',
                            badge.variant === 'destructive'
                              ? 'text-destructive'
                              : 'text-muted-foreground',
                          )}
                        >
                          {badge.label}
                        </div>
                      )}
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
          {sync !== 'idle' && (
            <Badge variant={SYNC_BADGE[sync].variant} data-testid="dynamic-sync-status">
              {SYNC_BADGE[sync].label}
            </Badge>
          )}
          {sync === 'conflict' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => workbench.reloadDynamicFromDisk()}
                data-testid="dynamic-reload-from-disk"
              >
                Reload from disk
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => workbench.keepDynamicEdits()}
                data-testid="dynamic-keep-edits"
              >
                Keep my edits
              </Button>
            </>
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
              disabled={saveBlocked !== null}
              title={saveBlocked ?? undefined}
              data-testid="dynamic-profile-save"
            >
              Save as {newBasename}
            </Button>
            {workbench.selectedDynamicProfileBasename && (
              <Button
                size="sm"
                variant="outline"
                disabled={saveBlocked !== null}
                title={saveBlocked ?? undefined}
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
          <AnalysisPanel />
        </CardContent>
      </Card>
    </div>
  );
});
