import { makeAutoObservable } from 'mobx';
import { ConnectionStore } from './ConnectionStore';
import { MonitorStore } from './MonitorStore';
import { ConsoleStore } from './ConsoleStore';
import { WorkbenchStore } from './WorkbenchStore';

export class RootStore {
  readonly connection: ConnectionStore;
  readonly monitor: MonitorStore;
  readonly console: ConsoleStore;
  readonly workbench: WorkbenchStore;

  constructor() {
    this.connection = new ConnectionStore();
    this.monitor = new MonitorStore();
    this.console = new ConsoleStore();
    this.workbench = new WorkbenchStore();
    makeAutoObservable(this, {
      connection: false,
      monitor: false,
      console: false,
      workbench: false,
    });
  }
}
