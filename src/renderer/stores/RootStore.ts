import { makeAutoObservable } from 'mobx';
import { ConnectionStore } from './ConnectionStore';
import { MonitorStore } from './MonitorStore';
import { ConsoleStore } from './ConsoleStore';
import { WorkbenchStore } from './WorkbenchStore';
import { ActivityStore } from './ActivityStore';
import { EntityFocusStore } from './EntityFocusStore';
import { TmuxStore } from './TmuxStore';
import { ColorPresetStore } from './ColorPresetStore';
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
  private focusRequestSeq = 0;

  constructor() {
    this.connection = new ConnectionStore();
    this.entityFocus = new EntityFocusStore();
    this.monitor = new MonitorStore(() => this.reconcileEntityFocusWithLayout());
    this.console = new ConsoleStore(this.entityFocus);
    this.workbench = new WorkbenchStore();
    this.activity = new ActivityStore();
    this.tmux = new TmuxStore();
    this.colorPresets = new ColorPresetStore();
    makeAutoObservable(this, {
      connection: false,
      entityFocus: false,
      monitor: false,
      console: false,
      workbench: false,
      activity: false,
      tmux: false,
      colorPresets: false,
    });
  }

  // [LAW:single-enforcer] The one place a docs deep-link becomes navigation. The DocLink is data;
  // this exhaustive match is the only translation from "where the index points" to store state, so
  // the destination cannot be opened two inconsistent ways from two callsites.
  navigateToDoc(link: DocLink): void {
    switch (link.kind) {
      case 'escape':
        this.workbench.setArtifact('escape-sequence');
        this.workbench.setEscapeTemplate(link.templateId);
        return;
      case 'console':
        this.console.setAction(link.action);
        return;
    }
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
