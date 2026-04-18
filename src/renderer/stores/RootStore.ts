import { makeAutoObservable } from 'mobx';

export class RootStore {
  placeholder = 0;

  constructor() {
    makeAutoObservable(this);
  }

  tick(): void {
    this.placeholder += 1;
  }
}
