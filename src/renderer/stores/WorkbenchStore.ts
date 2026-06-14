import { makeAutoObservable, observable, runInAction } from 'mobx';
import type {
  ActionResult,
  ArrangementSnapshot,
  BroadcastDomainsResult,
  DynamicProfileSnapshot,
  KeyBindingsSnapshot,
  ProfileSummary,
  RegistrationSpec,
  RegistrationBody,
  RegistrationRole,
  RegistrationSnapshot,
  CustomEscapeSnapshot,
  KnobSpec,
  FileExportResult,
} from '@shared/rpc';
import {
  analyzeDynamicProfile,
  parentCandidates,
  folderBlockingFiles,
  type DynamicProfileAnalysis,
  type ParentCandidate,
} from '@shared/dynamicProfiles';
import {
  addDomain,
  domainsEqual,
  moveSession,
  removeDomain,
  type BroadcastDraft,
} from '@shared/broadcastDomains';

export type WorkbenchArtifact =
  | 'profile'
  | 'dynamic-profile'
  | 'escape-sequence'
  | 'registrations'
  | 'triggers'
  | 'arrangement'
  | 'broadcast-domain'
  | 'key-bindings';

const EMPTY_DYNAMIC: DynamicProfileSnapshot = {
  folder: '',
  folderExists: false,
  files: [],
  lastError: null,
};

interface EscapeEmitted {
  sequence: string;
  result: ActionResult;
}

// [LAW:types-are-the-program] The editor's relationship to disk, enumerated. 'idle' = no buffer;
// 'draft' = unsaved new buffer with no disk counterpart; 'synced' = buffer follows disk;
// 'dirty' = local edits, disk unchanged underneath; 'conflict' = local edits AND the file changed
// on disk since load; 'deleted' = the selected file vanished from disk. Hot reload is a state the
// user can see and act on, never a silent body swap. [LAW:no-ambient-temporal-coupling]
export type DynamicSyncStatus = 'idle' | 'draft' | 'synced' | 'dirty' | 'conflict' | 'deleted';

export class WorkbenchStore {
  artifact: WorkbenchArtifact = 'profile';

  profiles: ProfileSummary[] = [];
  profilesLoaded = false;
  profilesError: string | null = null;
  selectedProfileGuid: string | null = null;

  dynamicProfiles: DynamicProfileSnapshot = EMPTY_DYNAMIC;
  selectedDynamicProfileBasename: string | null = null;
  dynamicEditorBody = '';
  dynamicEditorDirty = false;
  // The disk body the buffer was last loaded from or saved as — the baseline that makes
  // 'conflict' (disk moved under local edits) detectable as a value comparison.
  dynamicEditorBaseBody: string | null = null;
  // Save/delete IO failures only; what the buffer *means* lives in dynamicEditorAnalysis.
  dynamicLastError: string | null = null;

  escapeTemplateId = 'osc1337-set-mark';
  escapeTemplateTarget = '';
  escapeTemplateValues: Record<string, Record<string, string>> = {};
  escapeLastSent: EscapeEmitted | null = null;
  escapeLastCopied: string | null = null;

  registrationForm: RegistrationFormState = initialRegistrationForm();
  registrationsSnapshot: RegistrationSnapshot = {
    registrations: [],
    invocations: [],
    totalInvocations: 0,
  };
  registrationLastResult: {
    ok: boolean;
    error: string | null;
    registrationId: string | null;
  } | null = null;
  // null until the first export — distinct from a cancelled dialog (a result whose error is null).
  pythonExportResult: FileExportResult | null = null;

  customEscapeSnapshot: CustomEscapeSnapshot = {
    subscriptions: [],
    entries: [],
    totalSeen: 0,
    capacity: 0,
  };
  customEscapeLastError: string | null = null;

  // null until the first refresh — "not asked yet" is a distinct state from either source failing.
  arrangements: ArrangementSnapshot | null = null;
  selectedArrangementName: string | null = null;
  // The second operand of the diff; the inspected arrangement is the first.
  diffArrangementName: string | null = null;

  // null until the first read — "not asked yet" is distinct from the engine failing.
  broadcastDomains: BroadcastDomainsResult | null = null;
  // The editing buffer over the live table. Every op replaces it whole with a new value from the
  // pure @shared/broadcastDomains helpers; null means "no live table loaded to edit yet".
  broadcastDraft: BroadcastDraft | null = null;
  // The engine table the draft was seeded from — the baseline that makes dirtiness a pure value
  // comparison, insensitive to whether the latest read happened to fail. (Same contract as
  // dynamicEditorBaseBody.) [LAW:one-source-of-truth]
  broadcastDraftBase: BroadcastDraft | null = null;
  // Click-to-move modality: the session chip armed for "move here". The drag modality carries the
  // same value through dataTransfer instead; both land on moveBroadcastSession.
  armedBroadcastSessionId: string | null = null;

  // null until the first read — "not asked yet" distinct from the defaults read failing.
  keyBindings: KeyBindingsSnapshot | null = null;

  constructor() {
    // [LAW:one-source-of-truth] The arrangement and broadcast snapshots are immutable values
    // swapped whole on refresh; their content is rendered, never edited in place. Deep observation
    // would wrap them in Proxies (the structured-clone-over-IPC trap from PR #18) for zero benefit.
    // The broadcast draft is likewise replaced whole by every pure op, so its arrays must stay
    // plain values too — they ride back across IPC when applied.
    makeAutoObservable(this, {
      arrangements: observable.ref,
      broadcastDomains: observable.ref,
      broadcastDraft: observable.ref,
      broadcastDraftBase: observable.ref,
      keyBindings: observable.ref,
    });
  }

  setArtifact(a: WorkbenchArtifact): void {
    this.artifact = a;
  }

  // [LAW:one-source-of-truth] Selection is just the GUID; everything shown for the selected
  // profile is read straight from ProfileSummary.properties at render time — no parsed copy.
  selectProfile(guid: string | null): void {
    this.selectedProfileGuid = guid;
  }

  async refreshProfiles(): Promise<void> {
    const result = await window.ipc.invoke('workbench/list-profiles', undefined as never);
    runInAction(() => {
      this.profiles = result.profiles;
      this.profilesLoaded = true;
      this.profilesError = result.ok ? null : result.error ?? 'unknown error';
    });
  }

  get dynamicSyncStatus(): DynamicSyncStatus {
    const basename = this.selectedDynamicProfileBasename;
    if (!basename) return this.dynamicEditorBody === '' ? 'idle' : 'draft';
    const disk = this.dynamicProfiles.files.find((f) => f.basename === basename);
    if (!disk) return 'deleted';
    if (!this.dynamicEditorDirty) return 'synced';
    return disk.body !== this.dynamicEditorBaseBody ? 'conflict' : 'dirty';
  }

  get dynamicEditorAnalysis(): DynamicProfileAnalysis | null {
    if (this.dynamicSyncStatus === 'idle') return null;
    return analyzeDynamicProfile(this.dynamicEditorBody);
  }

  get dynamicFileAnalyses(): Array<{ basename: string; analysis: DynamicProfileAnalysis }> {
    return this.dynamicProfiles.files.map((f) => ({
      basename: f.basename,
      analysis: analyzeDynamicProfile(f.body),
    }));
  }

  // iTerm2 skips processing the ENTIRE DynamicProfiles folder while any file is malformed;
  // these are the files currently poisoning it.
  get dynamicFolderBlockers(): string[] {
    return folderBlockingFiles(this.dynamicFileAnalyses);
  }

  // The universe a parent ref resolves against: iTerm2's live profile list, the other folder
  // files, and the buffer itself (so siblings within the file being edited resolve too). The
  // selected file's disk version is excluded — the buffer is its truth while it is open.
  get dynamicParentCandidates(): ParentCandidate[] {
    const others = this.dynamicFileAnalyses.filter(
      (f) => f.basename !== this.selectedDynamicProfileBasename,
    );
    const buffer = this.dynamicEditorAnalysis;
    const bufferAsFile = buffer
      ? [{ basename: this.selectedDynamicProfileBasename ?? 'this file', analysis: buffer }]
      : [];
    return parentCandidates(this.profiles, [...others, ...bufferAsFile]);
  }

  // [LAW:no-silent-failure] Saving invalid JSON or an empty file would make iTerm2 silently
  // ignore the whole folder; the block and its reason are one derived value the UI shows verbatim.
  get dynamicSaveBlocked(): string | null {
    const a = this.dynamicEditorAnalysis;
    if (!a) return 'nothing to save';
    if (a.kind === 'json-error') return `invalid JSON: ${a.message}`;
    if (a.kind === 'empty') return 'file is empty';
    return null;
  }

  applyDynamicSnapshot(snap: DynamicProfileSnapshot): void {
    this.dynamicProfiles = snap;
    // Hot reload: a clean buffer follows disk. A dirty buffer is left alone — the divergence
    // surfaces as the 'conflict' state with explicit reload/keep actions, never a silent swap.
    if (this.selectedDynamicProfileBasename && !this.dynamicEditorDirty) {
      const match = snap.files.find(
        (f) => f.basename === this.selectedDynamicProfileBasename,
      );
      if (match) {
        this.dynamicEditorBody = match.body;
        this.dynamicEditorBaseBody = match.body;
      }
    }
  }

  reloadDynamicFromDisk(): void {
    const match = this.dynamicProfiles.files.find(
      (f) => f.basename === this.selectedDynamicProfileBasename,
    );
    if (!match) return;
    this.dynamicEditorBody = match.body;
    this.dynamicEditorBaseBody = match.body;
    this.dynamicEditorDirty = false;
  }

  // Resolve a conflict in favor of the local edits: rebase the baseline onto the current disk
  // body so the state returns to 'dirty' — the user has seen and dismissed the disk change.
  keepDynamicEdits(): void {
    const match = this.dynamicProfiles.files.find(
      (f) => f.basename === this.selectedDynamicProfileBasename,
    );
    if (!match) return;
    this.dynamicEditorBaseBody = match.body;
  }

  async refreshDynamicProfiles(): Promise<void> {
    const snap = await window.ipc.invoke(
      'workbench/dynamic-profiles',
      undefined as never,
    );
    runInAction(() => this.applyDynamicSnapshot(snap));
  }

  selectDynamicProfile(basename: string | null): void {
    this.selectedDynamicProfileBasename = basename;
    this.dynamicEditorDirty = false;
    if (!basename) {
      this.dynamicEditorBody = '';
      this.dynamicEditorBaseBody = null;
      return;
    }
    const match = this.dynamicProfiles.files.find((f) => f.basename === basename);
    this.dynamicEditorBody = match?.body ?? '';
    this.dynamicEditorBaseBody = match?.body ?? null;
  }

  setDynamicEditorBody(body: string): void {
    this.dynamicEditorBody = body;
    this.dynamicEditorDirty = true;
  }

  async saveDynamicProfile(basename: string): Promise<void> {
    if (!basename) {
      this.dynamicLastError = 'basename required';
      return;
    }
    const blocked = this.dynamicSaveBlocked;
    if (blocked) {
      // The save button is disabled while blocked; a programmatic call still fails loudly.
      this.dynamicLastError = blocked;
      return;
    }
    const body = this.dynamicEditorBody;
    const result = await window.ipc.invoke('workbench/save-dynamic-profile', {
      basename,
      body,
    });
    runInAction(() => {
      if (result.ok) {
        this.dynamicEditorDirty = false;
        this.dynamicEditorBaseBody = body;
        this.dynamicLastError = null;
        this.selectedDynamicProfileBasename = basename;
      } else {
        this.dynamicLastError = result.error ?? 'save failed';
      }
    });
  }

  async deleteDynamicProfile(basename: string): Promise<void> {
    const result = await window.ipc.invoke('workbench/delete-dynamic-profile', {
      basename,
    });
    runInAction(() => {
      if (!result.ok) {
        this.dynamicLastError = result.error ?? 'delete failed';
      } else {
        this.dynamicLastError = null;
        this.selectedDynamicProfileBasename = null;
        this.dynamicEditorBody = '';
        this.dynamicEditorBaseBody = null;
      }
    });
  }

  setEscapeTemplate(id: string): void {
    this.escapeTemplateId = id;
  }

  setEscapeField(templateId: string, name: string, value: string): void {
    if (!this.escapeTemplateValues[templateId]) this.escapeTemplateValues[templateId] = {};
    this.escapeTemplateValues[templateId][name] = value;
  }

  setEscapeTarget(target: string): void {
    this.escapeTemplateTarget = target;
  }

  recordEscape(sequence: string, result: ActionResult): void {
    this.escapeLastSent = { sequence, result };
  }

  recordEscapeCopy(sequence: string): void {
    this.escapeLastCopied = sequence;
  }

  updateRegistrationForm(patch: Partial<RegistrationFormState>): void {
    this.registrationForm = { ...this.registrationForm, ...patch };
  }

  addKnob(knob: KnobSpec): void {
    this.registrationForm = {
      ...this.registrationForm,
      statusBarKnobs: [...this.registrationForm.statusBarKnobs, knob],
    };
  }

  removeKnob(idx: number): void {
    const next = [...this.registrationForm.statusBarKnobs];
    next.splice(idx, 1);
    this.registrationForm = { ...this.registrationForm, statusBarKnobs: next };
  }

  updateKnob(idx: number, patch: Partial<KnobSpec>): void {
    const next = [...this.registrationForm.statusBarKnobs];
    if (!next[idx]) return;
    next[idx] = { ...next[idx], ...patch };
    this.registrationForm = { ...this.registrationForm, statusBarKnobs: next };
  }

  applyRegistrationsSnapshot(snap: RegistrationSnapshot): void {
    this.registrationsSnapshot = snap;
  }

  async refreshRegistrations(): Promise<void> {
    const snap = await window.ipc.invoke('workbench/registrations', undefined as never);
    runInAction(() => this.applyRegistrationsSnapshot(snap));
  }

  // [LAW:one-source-of-truth] The single editor→spec translation: the Preview card renders exactly
  // this value and Install sends exactly this value (plus the id assigned at install time), so what
  // the user sees and what iTerm2 receives cannot drift.
  get registrationDraft(): RegistrationBody {
    const form = this.registrationForm;
    const rpcCommon = {
      name: form.name,
      arguments: form.argumentsCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      defaults: [],
      timeout: form.timeout,
      responseTemplate: form.responseTemplate,
    };
    switch (form.role) {
      case 'generic':
        return { ...rpcCommon, role: 'generic' };
      case 'status-bar':
        return {
          ...rpcCommon,
          role: 'status-bar',
          attrs: {
            shortDescription: form.statusBarShortDescription,
            detailedDescription: form.statusBarDetailedDescription,
            knobs: form.statusBarKnobs.map((k) => ({ ...k })),
            exemplar: form.statusBarExemplar,
            updateCadence: form.statusBarCadence,
            uniqueIdentifier: form.statusBarUniqueIdentifier,
            format: 'PLAIN_TEXT',
          },
        };
      case 'session-title':
        return {
          ...rpcCommon,
          role: 'session-title',
          attrs: {
            displayName: form.displayName,
            uniqueIdentifier: form.uniqueIdentifier,
          },
        };
      case 'context-menu':
        return {
          ...rpcCommon,
          role: 'context-menu',
          attrs: {
            displayName: form.displayName,
            uniqueIdentifier: form.uniqueIdentifier,
          },
        };
      case 'toolbelt':
        return {
          role: 'toolbelt',
          attrs: {
            displayName: form.toolbeltDisplayName,
            identifier: form.toolbeltIdentifier,
            url: form.toolbeltUrl,
            revealIfAlreadyRegistered: form.toolbeltReveal,
          },
        };
    }
  }

  async registerRpc(): Promise<void> {
    const body = this.registrationDraft;
    if (body.role !== 'toolbelt') {
      try {
        JSON.parse(body.responseTemplate);
      } catch (err) {
        runInAction(() => {
          this.registrationLastResult = {
            ok: false,
            error: `Response JSON invalid: ${err instanceof Error ? err.message : err}`,
            registrationId: null,
          };
        });
        return;
      }
    }
    const spec: RegistrationSpec = {
      ...body,
      id: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    const result = await window.ipc.invoke('workbench/register-rpc', spec);
    runInAction(() => {
      this.registrationLastResult = result;
    });
    if (result.ok) {
      await this.refreshRegistrations();
    }
  }

  // [LAW:types-are-the-program] Narrowing off the toolbelt arm hands the IPC an RpcRegistrationBody —
  // the only shape with a Python stub — so a toolbelt export is unrepresentable, not a runtime guard.
  async exportPythonStub(): Promise<void> {
    const body = this.registrationDraft;
    if (body.role === 'toolbelt') return;
    const result = await window.ipc.invoke('registration/export-python', { body, path: null });
    runInAction(() => {
      this.pythonExportResult = result;
    });
  }

  async unregisterRpc(id: string): Promise<void> {
    await window.ipc.invoke('workbench/unregister-rpc', { id });
    await this.refreshRegistrations();
  }

  applyCustomEscapeSnapshot(snap: CustomEscapeSnapshot): void {
    this.customEscapeSnapshot = snap;
  }

  async refreshCustomEscape(): Promise<void> {
    const snap = await window.ipc.invoke('workbench/custom-escape', undefined as never);
    runInAction(() => this.applyCustomEscapeSnapshot(snap));
  }

  // [LAW:effects-at-boundaries] Both the effective target session and the identity are resolved
  // at the UI seam (entityFocus + override, the emitter template's identity field) and handed in
  // as values; the store never reaches for ambient focus or a parallel form.
  async subscribeCustomEscape(sessionId: string, identity: string): Promise<void> {
    if (!sessionId) {
      this.customEscapeLastError = 'session required';
      return;
    }
    const result = await window.ipc.invoke('workbench/subscribe-custom-escape', {
      sessionId,
      identity,
    });
    runInAction(() => {
      this.customEscapeLastError = result.ok ? null : result.error ?? 'subscribe failed';
    });
    if (result.ok) await this.refreshCustomEscape();
  }

  async unsubscribeCustomEscape(subscriptionId: string): Promise<void> {
    await window.ipc.invoke('workbench/unsubscribe-custom-escape', { subscriptionId });
    await this.refreshCustomEscape();
  }

  async refreshArrangements(): Promise<void> {
    const snap = await window.ipc.invoke('workbench/arrangements', undefined as never);
    runInAction(() => {
      this.arrangements = snap;
    });
  }

  selectArrangement(name: string | null): void {
    this.selectedArrangementName = name;
  }

  selectDiffArrangement(name: string | null): void {
    this.diffArrangementName = name;
  }

  async refreshBroadcastDomains(): Promise<void> {
    const result = await window.ipc.invoke('workbench/broadcast-domains', undefined as never);
    runInAction(() => {
      // A clean draft follows the engine; a dirty draft is the user's pending intent and is left
      // alone — the divergence renders as the dirty state with explicit apply/reset, never a
      // silent buffer swap. (Same contract as the dynamic-profile editor.) Dirtiness is draft vs.
      // the baseline it was seeded from, so an intervening failed read cannot poison the check
      // and discard edits on the next successful one.
      this.broadcastDomains = result;
      if (result.ok) {
        if (!this.broadcastDraftDirty) {
          this.broadcastDraft = result.domains;
          this.broadcastDraftBase = result.domains;
        } else if (this.broadcastDraft !== null && domainsEqual(this.broadcastDraft, result.domains)) {
          // The engine caught up with the pending edits (the apply landed): the draft is no
          // longer pending intent but the synced state — rebase so it reads clean.
          this.broadcastDraftBase = result.domains;
        }
      }
    });
  }

  get broadcastDraftDirty(): boolean {
    if (this.broadcastDraft === null || this.broadcastDraftBase === null) return false;
    return !domainsEqual(this.broadcastDraft, this.broadcastDraftBase);
  }

  addBroadcastDomain(): void {
    if (this.broadcastDraft === null) return;
    this.broadcastDraft = addDomain(this.broadcastDraft);
  }

  removeBroadcastDomain(index: number): void {
    if (this.broadcastDraft === null) return;
    this.broadcastDraft = removeDomain(this.broadcastDraft, index);
  }

  // The single move seam both modalities (drag-drop and click-to-move) feed; null target means
  // "out of every domain". Moving also disarms the click modality — the gesture is complete.
  moveBroadcastSession(sessionId: string, toDomainIndex: number | null): void {
    if (this.broadcastDraft === null) return;
    this.broadcastDraft = moveSession(this.broadcastDraft, sessionId, toDomainIndex);
    this.armedBroadcastSessionId = null;
  }

  armBroadcastSession(sessionId: string | null): void {
    this.armedBroadcastSessionId = sessionId;
  }

  // Discard pending edits in favor of the engine: the draft re-seeds from the last successful
  // read, which becomes the new baseline.
  resetBroadcastDraft(): void {
    if (this.broadcastDomains?.ok) {
      this.broadcastDraft = this.broadcastDomains.domains;
      this.broadcastDraftBase = this.broadcastDomains.domains;
    }
  }

  async refreshKeyBindings(): Promise<void> {
    const snap = await window.ipc.invoke('workbench/key-bindings', undefined as never);
    runInAction(() => {
      this.keyBindings = snap;
    });
  }

  // [LAW:one-source-of-truth] Each source stays authoritative for its own facet: the engine LIST
  // for which names exist, the defaults domain for which have readable content. The index is the
  // derived union, carrying per-name membership in each source so disagreement (cfprefsd lag, a
  // stale defaults cache) renders as fact instead of being papered over.
  get arrangementIndex(): Array<{ name: string; inEngine: boolean; hasContent: boolean }> {
    if (!this.arrangements) return [];
    const engineNames = this.arrangements.names.ok ? this.arrangements.names.names : [];
    const contentNames = this.arrangements.contents.ok
      ? Object.keys(this.arrangements.contents.arrangements)
      : [];
    const all = [...new Set([...engineNames, ...contentNames])].sort();
    return all.map((name) => ({
      name,
      inEngine: engineNames.includes(name),
      hasContent: contentNames.includes(name),
    }));
  }
}

interface RegistrationFormState {
  role: RegistrationRole;
  name: string;
  argumentsCsv: string;
  timeout: number;
  responseTemplate: string;
  statusBarShortDescription: string;
  statusBarDetailedDescription: string;
  statusBarExemplar: string;
  statusBarCadence: number;
  statusBarUniqueIdentifier: string;
  statusBarKnobs: KnobSpec[];
  displayName: string;
  uniqueIdentifier: string;
  toolbeltDisplayName: string;
  toolbeltIdentifier: string;
  toolbeltUrl: string;
  toolbeltReveal: boolean;
}

function initialRegistrationForm(): RegistrationFormState {
  return {
    role: 'status-bar',
    name: 'workbench_sb',
    argumentsCsv: 'knobs',
    timeout: 5,
    responseTemplate: '"Hello from Workbench"',
    statusBarShortDescription: 'Workbench demo',
    statusBarDetailedDescription: 'Reports the current time on a cadence.',
    statusBarExemplar: '12:34',
    statusBarCadence: 5,
    statusBarUniqueIdentifier: 'com.example.workbench-demo',
    statusBarKnobs: [],
    displayName: 'Workbench title',
    uniqueIdentifier: 'com.example.workbench-title',
    toolbeltDisplayName: 'Workbench tool',
    toolbeltIdentifier: 'com.example.workbench-tool',
    toolbeltUrl: 'https://iterm2.com',
    toolbeltReveal: true,
  };
}

