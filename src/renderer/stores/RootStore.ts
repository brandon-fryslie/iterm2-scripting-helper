import { makeAutoObservable } from 'mobx';
import { ConnectionStore } from './ConnectionStore';

export class RootStore {
  readonly connection: ConnectionStore;

  constructor() {
    this.connection = new ConnectionStore();
    makeAutoObservable(this, { connection: false });
  }
}
