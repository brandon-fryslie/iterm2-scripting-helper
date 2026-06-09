import { makeAutoObservable, observable } from 'mobx';
import type { AppLayout, AppWindow, AppSession } from '@shared/domain';

export interface LayoutSnapshot {
  windows: AppWindow[];
  buriedSessions: AppSession[];
  lastUpdatedAt: number;
}

export class LayoutStore {
  windows: AppWindow[] = [];
  buriedSessions: AppSession[] = [];
  lastUpdatedAt = 0;

  constructor() {
    makeAutoObservable(this, {
      windows: observable.ref,
      buriedSessions: observable.ref,
    });
  }

  apply(layout: AppLayout): void {
    this.windows = layout.windows;
    this.buriedSessions = layout.buriedSessions;
    this.lastUpdatedAt = Date.now();
  }

  clear(): void {
    this.windows = [];
    this.buriedSessions = [];
    this.lastUpdatedAt = 0;
  }

  snapshot(): LayoutSnapshot {
    return {
      windows: this.windows,
      buriedSessions: this.buriedSessions,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }
}
