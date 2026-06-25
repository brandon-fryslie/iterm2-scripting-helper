import { makeAutoObservable, reaction, runInAction } from 'mobx';
import type { AppActionResult } from '@shared/domain';
import { toHex } from '@shared/escape-sequences';
import {
  findTemplateTarget,
  previewFromProbe,
  TEMPLATE_TARGETS,
  type TemplatePreview,
  type TemplateTarget,
  type TemplateTargetId,
} from '@shared/templateDesigner';
import { versionedCell } from './persistence';
import type { EntityFocusStore } from './EntityFocusStore';

// [LAW:one-source-of-truth] The persisted authoring unit is exactly {targetId, draft} — the third draft
// surface alongside Console snippets and the probe draft. The preview and applyResult are derived/effect
// state that reset on every edit by design, so they are never persisted; only the authoring intent is.
interface TemplateDraftPersisted {
  targetId: TemplateTargetId;
  draft: string;
}

const TARGET_IDS: ReadonlySet<string> = new Set(TEMPLATE_TARGETS.map((t) => t.id));

// [LAW:no-silent-failure] targetId is a closed enum; a persisted id outside it (corrupt, or from a
// renamed target set) makes the whole blob untrustworthy, so it is dropped+warned rather than coerced.
function decodeTemplateDraft(data: unknown): TemplateDraftPersisted | null {
  if (typeof data !== 'object' || data === null) return null;
  const { targetId, draft } = data as Record<string, unknown>;
  if (typeof targetId !== 'string' || !TARGET_IDS.has(targetId)) return null;
  if (typeof draft !== 'string') return null;
  return { targetId: targetId as TemplateTargetId, draft };
}

const TEMPLATE_DRAFT_CELL = versionedCell<TemplateDraftPersisted>({
  key: 'template-designer-draft',
  version: 1,
  fallback: () => ({ targetId: 'badge', draft: '' }),
  decode: decodeTemplateDraft,
});

// [LAW:decomposition] The Live Template Designer's authoring state and the two boundary calls it drives —
// nothing more. Evaluation is the existing probe seam (`monitor/probe-variable`, which interpolates a
// `\(…)` template through iTerm2's own engine), and application is the existing inject seam
// (`actions/inject`, which delivers escape bytes as terminal output). This store owns neither the
// interpolation nor the variable set: it reads the canonical variable snapshot from MonitorStore for
// insertion and routes both effects through the channels that already exist ([LAW:one-source-of-truth]).
export class TemplateDesignerStore {
  targetId: TemplateTargetId;
  draft: string;
  // [LAW:no-silent-failure] The preview always corresponds to the CURRENT draft: editing the draft
  // resets it to `idle` so a stale render is never shown as if it were live. A resolved preview, an
  // empty render, and an error are each distinct visible states — never a blank that hides which.
  preview: TemplatePreview = { state: 'idle' };
  applyPending = false;
  applyResult: AppActionResult | null = null;
  private readonly entityFocus: EntityFocusStore;

  constructor(entityFocus: EntityFocusStore) {
    this.entityFocus = entityFocus;
    // [LAW:no-ambient-temporal-coupling] Load before makeAutoObservable wires the reaction, so the
    // restored draft is the initial state and not a change the persistence reaction writes back.
    const persisted = TEMPLATE_DRAFT_CELL.load();
    this.targetId = persisted.targetId;
    this.draft = persisted.draft;
    makeAutoObservable<TemplateDesignerStore, 'entityFocus'>(this, { entityFocus: false });
    // [LAW:effects-at-boundaries] The draft+target are mirrored from this one boundary reaction; the
    // preview stays ephemeral (it resets to idle on every edit, so persisting it would restore a stale
    // render as if it were live).
    reaction(
      () => ({ targetId: this.targetId, draft: this.draft }),
      (state) => TEMPLATE_DRAFT_CELL.save(state),
    );
  }

  get target(): TemplateTarget {
    return findTemplateTarget(this.targetId);
  }

  setTarget(id: TemplateTargetId): void {
    // The preview depends only on the draft (what iTerm2 interpolates), not on the target (how the
    // result is applied), so switching targets leaves a resolved preview intact.
    this.targetId = id;
  }

  setDraft(value: string): void {
    this.draft = value;
    this.preview = { state: 'idle' };
    this.applyResult = null;
  }

  // [LAW:dataflow-not-control-flow] Inserting a live variable is the same operation as typing it: the
  // reference is appended to the draft as a value. `name` is iTerm2's full reference (bare for
  // session-local variables, dotted for the cross-scope frames it surfaces), wrapped exactly once into
  // `\(…)` — the same single-wrap the probe rail uses, so successive inserts concatenate into a valid
  // interpolated template.
  insertReference(name: string): void {
    this.setDraft(`${this.draft}\\(${name})`);
  }

  // [LAW:effects-at-boundaries] The one read boundary: hand the authored template to the existing probe
  // RPC and map its self-describing outcome onto the preview. No interpolation happens here.
  async runPreview(): Promise<void> {
    const entity = this.entityFocus.selected;
    const template = this.draft;
    if (template.trim() === '') {
      runInAction(() => {
        this.preview = { state: 'idle' };
      });
      return;
    }
    runInAction(() => {
      this.preview = { state: 'pending' };
    });
    const probe = await window.ipc.invoke('monitor/probe-variable', { entity, expression: template });
    runInAction(() => {
      this.preview = previewFromProbe(probe);
    });
  }

  // [LAW:effects-at-boundaries] The one write boundary. Apply re-evaluates the current draft through the
  // same probe first, so it can never inject a stale render, then builds the target's escape and injects
  // it. A 'snapshot' target carries literal text, so an unresolved template stops the apply with the
  // error surfaced in the preview ([LAW:no-silent-failure]); a 'live' target (the badge) sends the format
  // regardless, because iTerm2 keeps re-interpolating it. `sessionId` is supplied non-null by the caller
  // — the apply affordance is disabled without a focused session, so "apply with no target" is
  // unrepresentable here rather than guarded ([LAW:no-defensive-null-guards]).
  async apply(sessionId: string): Promise<void> {
    const entity = this.entityFocus.selected;
    const target = this.target;
    const template = this.draft;
    runInAction(() => {
      this.applyPending = true;
      this.applyResult = null;
    });
    try {
      const probe = await window.ipc.invoke('monitor/probe-variable', { entity, expression: template });
      const preview = previewFromProbe(probe);
      runInAction(() => {
        this.preview = preview;
      });
      if (target.applyMode === 'snapshot' && preview.state !== 'rendered') {
        return;
      }
      const rendered = preview.state === 'rendered' ? preview.value : '';
      const sequence = target.buildSequence({ format: template, rendered });
      const result = await window.ipc.invoke('actions/inject', {
        entity,
        sessionIds: [sessionId],
        bytesHex: toHex(sequence),
      });
      runInAction(() => {
        this.applyResult = result;
      });
    } finally {
      runInAction(() => {
        this.applyPending = false;
      });
    }
  }
}
