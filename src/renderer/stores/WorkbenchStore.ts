import { makeAutoObservable, runInAction } from 'mobx';
import type {
  ActionResult,
  DynamicProfileSnapshot,
  ProfileSummary,
} from '@shared/rpc';

export type WorkbenchArtifact = 'profile' | 'dynamic-profile' | 'escape-sequence';

export interface ProfileEditState {
  name: string;
  backgroundHex: string;
  foregroundHex: string;
  badgeText: string;
  transparency: string;
  useTransparency: boolean;
}

const EMPTY_EDIT: ProfileEditState = {
  name: '',
  backgroundHex: '#000000',
  foregroundHex: '#ffffff',
  badgeText: '',
  transparency: '0',
  useTransparency: false,
};

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
  profileEdit: ProfileEditState = { ...EMPTY_EDIT };
  profileLastResult: ActionResult | null = null;

  dynamicProfiles: DynamicProfileSnapshot = EMPTY_DYNAMIC;
  selectedDynamicProfileBasename: string | null = null;
  dynamicEditorBody = '';
  dynamicEditorDirty = false;
  dynamicLastError: string | null = null;

  escapeTemplateId = 'osc1337-set-mark';
  escapeTemplateTarget = '';
  escapeTemplateValues: Record<string, Record<string, string>> = {};
  escapeLastSent: EscapeEmitted | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setArtifact(a: WorkbenchArtifact): void {
    this.artifact = a;
  }

  selectProfile(guid: string | null): void {
    this.selectedProfileGuid = guid;
    if (!guid) {
      this.profileEdit = { ...EMPTY_EDIT };
      return;
    }
    const p = this.profiles.find((x) => x.guid === guid);
    if (!p) return;
    const parse = (k: string) => {
      const raw = p.properties[k];
      if (raw == null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    };
    const bg = parse('Background Color') as Record<string, number> | undefined;
    const fg = parse('Foreground Color') as Record<string, number> | undefined;
    this.profileEdit = {
      name: (parse('Name') as string | undefined) ?? p.name,
      backgroundHex: bg ? rgbDictToHex(bg) : '#000000',
      foregroundHex: fg ? rgbDictToHex(fg) : '#ffffff',
      badgeText: (parse('Badge Text') as string | undefined) ?? '',
      transparency: String((parse('Transparency') as number | undefined) ?? 0),
      useTransparency: Boolean(parse('Use Transparency') as boolean | undefined),
    };
    this.profileLastResult = null;
  }

  updateEdit(patch: Partial<ProfileEditState>): void {
    this.profileEdit = { ...this.profileEdit, ...patch };
  }

  async refreshProfiles(): Promise<void> {
    const result = await window.ipc.invoke('workbench/list-profiles', undefined as never);
    runInAction(() => {
      this.profiles = result.profiles;
      this.profilesLoaded = true;
      this.profilesError = result.ok ? null : result.error ?? 'unknown error';
      if (this.selectedProfileGuid) {
        this.selectProfile(this.selectedProfileGuid);
      }
    });
  }

  async applyProfileEdits(): Promise<void> {
    if (!this.selectedProfileGuid) return;
    const edit = this.profileEdit;
    const assignments: Array<{ key: string; jsonValue: string }> = [];
    assignments.push({ key: 'Name', jsonValue: JSON.stringify(edit.name) });
    assignments.push({
      key: 'Background Color',
      jsonValue: JSON.stringify(hexToRgbDict(edit.backgroundHex)),
    });
    assignments.push({
      key: 'Foreground Color',
      jsonValue: JSON.stringify(hexToRgbDict(edit.foregroundHex)),
    });
    assignments.push({ key: 'Badge Text', jsonValue: JSON.stringify(edit.badgeText) });
    const transparency = Number(edit.transparency);
    if (!Number.isNaN(transparency)) {
      assignments.push({
        key: 'Transparency',
        jsonValue: JSON.stringify(transparency),
      });
    }
    assignments.push({
      key: 'Use Transparency',
      jsonValue: JSON.stringify(edit.useTransparency),
    });
    const result = await window.ipc.invoke('workbench/set-profile-property', {
      guids: [this.selectedProfileGuid],
      assignments,
    });
    runInAction(() => {
      this.profileLastResult = result;
    });
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
}

function hexToRgbDict(hex: string): Record<string, number | string> {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return {
      'Red Component': 0,
      'Green Component': 0,
      'Blue Component': 0,
      'Alpha Component': 1,
      'Color Space': 'sRGB',
    };
  }
  const n = parseInt(m[1], 16);
  return {
    'Red Component': ((n >> 16) & 0xff) / 255,
    'Green Component': ((n >> 8) & 0xff) / 255,
    'Blue Component': (n & 0xff) / 255,
    'Alpha Component': 1,
    'Color Space': 'sRGB',
  };
}

function rgbDictToHex(d: Record<string, unknown>): string {
  const r = Math.round(Number(d['Red Component'] ?? 0) * 255);
  const g = Math.round(Number(d['Green Component'] ?? 0) * 255);
  const b = Math.round(Number(d['Blue Component'] ?? 0) * 255);
  const hex = [r, g, b]
    .map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}
