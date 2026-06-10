import { makeAutoObservable, runInAction } from 'mobx';
import type {
  ActionResult,
  DynamicProfileSnapshot,
  ProfileSummary,
  RegistrationSpec,
  RegistrationRole,
  RegistrationSnapshot,
  CustomEscapeSnapshot,
  KnobSpec,
} from '@shared/rpc';
import {
  PROFILE_FIELDS,
  decodeProfile,
  encodeField,
  fieldValueEquals,
  isEncodableValue,
  type FieldValue,
} from '@shared/profileSchema';

export type WorkbenchArtifact =
  | 'profile'
  | 'dynamic-profile'
  | 'escape-sequence'
  | 'registrations'
  | 'custom-escape'
  | 'triggers';

// The edit surface is keyed by iTerm2 wire key, decoded from the schema — not a fixed interface.
// A new profile key appears in the editor by being in the schema, with no change here.
export type ProfileEdit = Record<string, FieldValue>;

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

export class WorkbenchStore {
  artifact: WorkbenchArtifact = 'profile';

  profiles: ProfileSummary[] = [];
  profilesLoaded = false;
  profilesError: string | null = null;
  selectedProfileGuid: string | null = null;
  // The values as loaded from the profile (the dirty baseline) and the working copy being edited.
  profileBaseline: ProfileEdit = {};
  profileEdit: ProfileEdit = {};
  profileLastResult: ActionResult | null = null;
  // Substring filter over profile names for bulk apply.
  profileFilter = '';

  dynamicProfiles: DynamicProfileSnapshot = EMPTY_DYNAMIC;
  selectedDynamicProfileBasename: string | null = null;
  dynamicEditorBody = '';
  dynamicEditorDirty = false;
  dynamicLastError: string | null = null;

  escapeTemplateId = 'osc1337-set-mark';
  escapeTemplateTarget = '';
  escapeTemplateValues: Record<string, Record<string, string>> = {};
  escapeLastSent: EscapeEmitted | null = null;

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

  customEscapeForm: CustomEscapeFormState = { sessionId: '', identity: '' };
  customEscapeSnapshot: CustomEscapeSnapshot = {
    subscriptions: [],
    entries: [],
    totalSeen: 0,
    capacity: 0,
  };
  customEscapeLastError: string | null = null;

  triggersDraft = '';
  triggersLastResult: { ok: boolean; error: string | null } | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setArtifact(a: WorkbenchArtifact): void {
    this.artifact = a;
  }

  selectProfile(guid: string | null): void {
    this.selectedProfileGuid = guid;
    if (!guid) {
      this.profileBaseline = {};
      this.profileEdit = {};
      return;
    }
    const p = this.profiles.find((x) => x.guid === guid);
    if (!p) return;
    // [LAW:dataflow-not-control-flow] Every field is decoded by the same schema-driven pass; the
    // old per-key branching (if Background Color … if Transparency …) is gone.
    const decoded = decodeProfile(p.properties);
    this.profileBaseline = decoded;
    this.profileEdit = { ...decoded };
    this.profileLastResult = null;
  }

  updateField(key: string, value: FieldValue): void {
    this.profileEdit = { ...this.profileEdit, [key]: value };
  }

  setProfileFilter(filter: string): void {
    this.profileFilter = filter;
  }

  // The keys whose working value differs from what the profile was loaded with — the minimal set
  // of assignments to send. [LAW:no-silent-failure] We only write what actually changed.
  get changedKeys(): string[] {
    return PROFILE_FIELDS.filter((spec) => {
      const edited = this.profileEdit[spec.key];
      const base = this.profileBaseline[spec.key];
      return edited != null && base != null && !fieldValueEquals(edited, base);
    }).map((spec) => spec.key);
  }

  // Changed fields whose value cannot be encoded to the wire (a malformed color hex). The write
  // boundary refuses to proceed while any exist, so a bad value is never silently written.
  get invalidChangedKeys(): string[] {
    return this.changedKeys.filter((key) => !isEncodableValue(this.profileEdit[key]));
  }

  private changedAssignments(): Array<{ key: string; jsonValue: string }> {
    return this.changedKeys.map((key) => ({
      key,
      jsonValue: encodeField(this.profileEdit[key]),
    }));
  }

  // [LAW:no-silent-failure][LAW:single-enforcer] The one gate every profile write passes through:
  // if any changed value is unencodable, surface it loudly and write nothing.
  private rejectInvalidChanges(): boolean {
    const invalid = this.invalidChangedKeys;
    if (invalid.length === 0) return false;
    this.profileLastResult = {
      ok: false,
      error: `Invalid value for: ${invalid.join(', ')}`,
      latencyMs: 0,
      responseCase: null,
      payload: null,
      requestId: null,
    };
    return true;
  }

  // Profiles whose name matches the bulk filter (case-insensitive substring; empty matches all).
  get filteredProfiles(): ProfileSummary[] {
    const q = this.profileFilter.trim().toLowerCase();
    if (!q) return this.profiles;
    return this.profiles.filter((p) => p.name.toLowerCase().includes(q));
  }

  async refreshProfiles(): Promise<void> {
    const result = await window.ipc.invoke('workbench/list-profiles', undefined as never);
    runInAction(() => {
      this.profiles = result.profiles;
      this.profilesLoaded = true;
      this.profilesError = result.ok ? null : result.error ?? 'unknown error';
      this.syncBaselineFromCache();
    });
  }

  // Re-derive the diff baseline for the selected profile from the latest fetched properties without
  // touching the working edit: a refresh (including the one after every successful write) re-syncs
  // the comparison point to server truth but never discards in-progress edits. Unlike selectProfile,
  // which is the load path that resets both baseline and working copy.
  private syncBaselineFromCache(): void {
    if (!this.selectedProfileGuid) return;
    const p = this.profiles.find((x) => x.guid === this.selectedProfileGuid);
    if (!p) return;
    this.profileBaseline = decodeProfile(p.properties);
  }

  async applyProfileEdits(): Promise<void> {
    if (!this.selectedProfileGuid) return;
    if (this.rejectInvalidChanges()) return;
    const assignments = this.changedAssignments();
    if (assignments.length === 0) return;
    const result = await window.ipc.invoke('workbench/set-profile-property', {
      guids: [this.selectedProfileGuid],
      assignments,
    });
    runInAction(() => {
      this.profileLastResult = result;
    });
    // [LAW:single-enforcer] Both write paths advance the baseline the one same way: re-fetch and let
    // refreshProfiles re-sync the diff baseline from server truth, so the diff clears after a write.
    if (result.ok) await this.refreshProfiles();
  }

  // Apply the pending changes (the same minimal assignment set) to every profile matching the
  // filter, in one request. This sets those keys to the edited values across the matched set.
  async bulkApplyEdits(): Promise<void> {
    if (this.rejectInvalidChanges()) return;
    const assignments = this.changedAssignments();
    const guids = this.filteredProfiles.map((p) => p.guid);
    if (assignments.length === 0 || guids.length === 0) return;
    const result = await window.ipc.invoke('workbench/set-profile-property', {
      guids,
      assignments,
    });
    runInAction(() => {
      this.profileLastResult = result;
    });
    if (result.ok) await this.refreshProfiles();
  }

  applyDynamicSnapshot(snap: DynamicProfileSnapshot): void {
    this.dynamicProfiles = snap;
    if (this.selectedDynamicProfileBasename && !this.dynamicEditorDirty) {
      const match = snap.files.find(
        (f) => f.basename === this.selectedDynamicProfileBasename,
      );
      if (match) this.dynamicEditorBody = match.body;
    }
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
      return;
    }
    const match = this.dynamicProfiles.files.find((f) => f.basename === basename);
    this.dynamicEditorBody = match?.body ?? '';
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
    try {
      JSON.parse(this.dynamicEditorBody);
    } catch (err) {
      this.dynamicLastError = `JSON invalid: ${err instanceof Error ? err.message : err}`;
      return;
    }
    const result = await window.ipc.invoke('workbench/save-dynamic-profile', {
      basename,
      body: this.dynamicEditorBody,
    });
    runInAction(() => {
      if (result.ok) {
        this.dynamicEditorDirty = false;
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

  async registerRpc(): Promise<void> {
    const form = this.registrationForm;
    const spec: RegistrationSpec = {
      id: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: form.role,
      name: form.name,
      arguments: form.argumentsCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      defaults: [],
      timeout: form.timeout,
      responseTemplate: form.responseTemplate,
      statusBar:
        form.role === 'status-bar'
          ? {
              shortDescription: form.statusBarShortDescription,
              detailedDescription: form.statusBarDetailedDescription,
              knobs: form.statusBarKnobs.map((k) => ({ ...k })),
              exemplar: form.statusBarExemplar,
              updateCadence: form.statusBarCadence,
              uniqueIdentifier: form.statusBarUniqueIdentifier,
              format: 'PLAIN_TEXT',
            }
          : undefined,
      sessionTitle:
        form.role === 'session-title'
          ? {
              displayName: form.displayName,
              uniqueIdentifier: form.uniqueIdentifier,
            }
          : undefined,
      contextMenu:
        form.role === 'context-menu'
          ? {
              displayName: form.displayName,
              uniqueIdentifier: form.uniqueIdentifier,
            }
          : undefined,
    };
    try {
      JSON.parse(spec.responseTemplate);
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
    const result = await window.ipc.invoke('workbench/register-rpc', spec);
    runInAction(() => {
      this.registrationLastResult = result;
    });
    if (result.ok) {
      await this.refreshRegistrations();
    }
  }

  async unregisterRpc(id: string): Promise<void> {
    await window.ipc.invoke('workbench/unregister-rpc', { id });
    await this.refreshRegistrations();
  }

  updateCustomEscapeForm(patch: Partial<CustomEscapeFormState>): void {
    this.customEscapeForm = { ...this.customEscapeForm, ...patch };
  }

  applyCustomEscapeSnapshot(snap: CustomEscapeSnapshot): void {
    this.customEscapeSnapshot = snap;
  }

  async refreshCustomEscape(): Promise<void> {
    const snap = await window.ipc.invoke('workbench/custom-escape', undefined as never);
    runInAction(() => this.applyCustomEscapeSnapshot(snap));
  }

  // [LAW:effects-at-boundaries] The effective target session is resolved at the UI seam from
  // entityFocus + the explicit override, then handed in as a value; the store never reaches for
  // ambient focus.
  async subscribeCustomEscape(sessionId: string): Promise<void> {
    if (!sessionId) {
      this.customEscapeLastError = 'session required';
      return;
    }
    const result = await window.ipc.invoke('workbench/subscribe-custom-escape', {
      sessionId,
      identity: this.customEscapeForm.identity,
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

  setTriggersDraft(draft: string): void {
    this.triggersDraft = draft;
  }

  async applyTriggersDraft(): Promise<void> {
    if (!this.selectedProfileGuid) return;
    try {
      const parsed = JSON.parse(this.triggersDraft);
      if (!Array.isArray(parsed)) {
        throw new Error('triggers must be a JSON array');
      }
    } catch (err) {
      runInAction(() => {
        this.triggersLastResult = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      });
      return;
    }
    const result = await window.ipc.invoke('workbench/set-profile-property', {
      guids: [this.selectedProfileGuid],
      assignments: [
        { key: 'Triggers', jsonValue: this.triggersDraft },
      ],
    });
    runInAction(() => {
      this.triggersLastResult = { ok: result.ok, error: result.error };
    });
    if (result.ok) void this.refreshProfiles();
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
  };
}

interface CustomEscapeFormState {
  sessionId: string;
  identity: string;
}
