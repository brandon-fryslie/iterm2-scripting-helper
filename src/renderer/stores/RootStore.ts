import { makeAutoObservable } from 'mobx';
import { ConnectionStore } from './ConnectionStore';
import { MonitorStore } from './MonitorStore';
import { ConsoleStore } from './ConsoleStore';
import { WorkbenchStore } from './WorkbenchStore';
import { EntityFocusStore } from './EntityFocusStore';
import { APP_ENTITY, type AppEntityRef } from '@shared/domain';

export class RootStore {
  readonly connection: ConnectionStore;
  readonly entityFocus: EntityFocusStore;
  readonly monitor: MonitorStore;
  readonly console: ConsoleStore;
  readonly workbench: WorkbenchStore;

  constructor() {
    this.connection = new ConnectionStore();
    this.entityFocus = new EntityFocusStore();
    this.monitor = new MonitorStore();
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
    this.entityFocus.select(entity);
    const loadedSessionId = await this.monitor.loadSessionFocus(this.entityFocus.sessionId);
    if (loadedSessionId !== this.entityFocus.sessionId) {
      this.entityFocus.select(APP_ENTITY);
    }
  }
}
