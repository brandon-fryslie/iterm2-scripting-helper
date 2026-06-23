import { makeAutoObservable } from 'mobx';
import { ConnectionStore } from './ConnectionStore';
import { MonitorStore } from './MonitorStore';
import { ConsoleStore } from './ConsoleStore';
import { WorkbenchStore } from './WorkbenchStore';
import { ActivityStore } from './ActivityStore';
import { EntityFocusStore } from './EntityFocusStore';
import { TmuxStore } from './TmuxStore';
import { ColorPresetStore } from './ColorPresetStore';
import { ErrorStore } from './ErrorStore';
import { WorkspaceStore } from './WorkspaceStore';
import { ThemeStore } from './ThemeStore';
import {
  APP_ENTITY,
  appEntityExistsInLayout,
  type AppEntityRef,
} from '@shared/domain';
import type { DocLink } from '@shared/docs';

export class RootStore {
  readonly connection: ConnectionStore;
  readonly entityFocus: EntityFocusStore;
  readonly monitor: MonitorStore;
  readonly console: ConsoleStore;
  readonly workbench: WorkbenchStore;
  readonly activity: ActivityStore;
  readonly tmux: TmuxStore;
  readonly colorPresets: ColorPresetStore;
  readonly errors: ErrorStore;
  readonly workspace: WorkspaceStore;
  readonly theme: ThemeStore;
  private focusRequestSeq = 0;

  constructor() {
    this.errors = new ErrorStore();
    // [LAW:single-enforcer] The composition root is where the driver-error edge is bound to the one
    // notice sink. Every connection snapshot — pushed or returned from connect/disconnect/refresh —
    // crosses that edge inside ConnectionStore.apply and records here, the same place fixture and
    // export outcomes are routed from the UI seam.
    this.connection = new ConnectionStore((message) =>
      this.errors.record({ tone: 'error', source: 'driver', message }),
    );
    this.entityFocus = new EntityFocusStore();
    this.monitor = new MonitorStore(() => this.reconcileEntityFocusWithLayout());
    this.console = new ConsoleStore(this.entityFocus);
    this.workbench = new WorkbenchStore();
    this.activity = new ActivityStore();
    this.tmux = new TmuxStore();
    this.colorPresets = new ColorPresetStore();
    this.workspace = new WorkspaceStore();
    this.theme = new ThemeStore();
    makeAutoObservable(this, {
      connection: false,
      entityFocus: false,
      monitor: false,
      console: false,
      workbench: false,
      activity: false,
      tmux: false,
      colorPresets: false,
      errors: false,
      workspace: false,
      theme: false,
    });
  }

  // [LAW:single-enforcer] The one place a docs deep-link becomes navigation. The DocLink is data;
  // this exhaustive match is the only translation from "where the index points" to store state, so
  // the destination cannot be opened two inconsistent ways from two callsites. Each destination also
  // brings its lens into focus ([LAW:no-silent-failure]): deep-linking to a pane that lives in a
  // non-focal lens would otherwise land the user on something not on screen.
  navigateToDoc(link: DocLink): void {
    switch (link.kind) {
      case 'escape':
        this.workspace.setLens('build');
        this.workbench.setArtifact('escape-sequence');
        this.workbench.setEscapeTemplate(link.templateId);
        return;
      case 'console':
        this.workspace.setLens('console');
        this.console.setAction(link.action);
        return;
    }
  }

  // [LAW:single-enforcer] The one place the Console inline result escalates to the full Events lens.
  // The just-fired event's `seq` is the single spine identity, so "open this in Events" is setLens +
  // select — never a re-derivation of which event to show. Mirrors navigateToDoc: a destination that
  // lives in a non-focal lens brings that lens into focus, so the selection is never off-screen.
  inspectEventInEvents(seq: number): void {
    this.workspace.setLens('events');
    this.activity.select(seq);
  }

  async selectEntityFocus(entity: AppEntityRef): Promise<void> {
    const seq = ++this.focusRequestSeq;
    this.entityFocus.select(this.validEntityOrApp(entity));
    const selectedEntity = this.entityFocus.selected;
    const requestedSessionId = this.entityFocus.sessionId;
    await Promise.all([
      this.monitor.loadSessionFocus(requestedSessionId),
      this.monitor.loadVariableFocus(selectedEntity),
    ]);
    if (seq !== this.focusRequestSeq) {
      return;
    }
    this.reconcileEntityFocusWithLayout();
  }

  private validEntityOrApp(entity: AppEntityRef): AppEntityRef {
    return appEntityExistsInLayout(this.monitor.layout, entity) ? entity : APP_ENTITY;
  }

  private reconcileEntityFocusWithLayout(): void {
    if (appEntityExistsInLayout(this.monitor.layout, this.entityFocus.selected)) {
      return;
    }
    this.focusRequestSeq++;
    this.entityFocus.select(APP_ENTITY);
    void Promise.all([
      this.monitor.loadSessionFocus(null),
      this.monitor.loadVariableFocus(APP_ENTITY),
    ]);
  }
}
