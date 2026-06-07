import { makeAutoObservable } from 'mobx';
import { ConnectionStore } from './ConnectionStore';
import { MonitorStore } from './MonitorStore';
import { ConsoleStore } from './ConsoleStore';
import { WorkbenchStore } from './WorkbenchStore';
import { EntityFocusStore } from './EntityFocusStore';
import {
  APP_ENTITY,
  appEntityExistsInLayout,
  type AppEntityRef,
} from '@shared/domain';

export class RootStore {
  readonly connection: ConnectionStore;
  readonly entityFocus: EntityFocusStore;
  readonly monitor: MonitorStore;
  readonly console: ConsoleStore;
  readonly workbench: WorkbenchStore;
  private focusRequestSeq = 0;

  constructor() {
    this.connection = new ConnectionStore();
    this.entityFocus = new EntityFocusStore();
    this.monitor = new MonitorStore(() => this.reconcileEntityFocusWithLayout());
    this.console = new ConsoleStore(this.entityFocus);
    this.workbench = new WorkbenchStore();
    makeAutoObservable(this, {
      connection: false,
      entityFocus: false,
      monitor: false,
      console: false,
      workbench: false,
    });
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
