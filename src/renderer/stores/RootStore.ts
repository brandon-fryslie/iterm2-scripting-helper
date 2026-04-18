import { makeAutoObservable } from 'mobx';
import { ConnectionStore } from './ConnectionStore';
import { MonitorStore } from './MonitorStore';
import { ConsoleStore } from './ConsoleStore';

export class RootStore {
  readonly connection: ConnectionStore;
  readonly monitor: MonitorStore;
  readonly console: ConsoleStore;

  constructor() {
    this.connection = new ConnectionStore();
    this.monitor = new MonitorStore();
    this.console = new ConsoleStore();
    makeAutoObservable(this, {
      connection: false,
      monitor: false,
      console: false,
    });
  }
}
