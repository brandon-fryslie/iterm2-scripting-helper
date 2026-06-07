import { makeAutoObservable } from 'mobx';
import {
  APP_ENTITY,
  type AppEntityRef,
  type AppEntitySessionRef,
  appEntityKey,
  isSessionEntity,
} from '@shared/domain';

export class EntityFocusStore {
  selected: AppEntityRef = APP_ENTITY;

  constructor() {
    makeAutoObservable(this);
  }

  select(entity: AppEntityRef): void {
    this.selected = entity;
  }

  get key(): string {
    return appEntityKey(this.selected);
  }

  get kind() {
    return this.selected.kind;
  }

  get windowId(): string | null {
    switch (this.selected.kind) {
      case 'app':
        return null;
      case 'window':
      case 'tab':
      case 'session':
        return this.selected.windowId;
    }
  }

  get tabId(): string | null {
    switch (this.selected.kind) {
      case 'app':
      case 'window':
        return null;
      case 'tab':
      case 'session':
        return this.selected.tabId;
    }
  }

  get session(): AppEntitySessionRef | null {
    return isSessionEntity(this.selected) ? this.selected : null;
  }

  get sessionId(): string | null {
    return this.session?.sessionId ?? null;
  }
}
