import { makeAutoObservable } from 'mobx';
import { ConnectionStore } from './ConnectionStore';
import { MonitorStore } from './MonitorStore';

export class RootStore {
  readonly connection: ConnectionStore;
  readonly monitor: MonitorStore;

  constructor() {
    this.connection = new ConnectionStore();
    this.monitor = new MonitorStore();
    makeAutoObservable(this, { connection: false, monitor: false });
  }
}
