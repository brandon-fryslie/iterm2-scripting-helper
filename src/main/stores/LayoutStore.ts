import { makeAutoObservable } from 'mobx';
import type { AppLayout, AppWindow } from '@shared/domain';

export interface LayoutSnapshot {
  windows: AppWindow[];
  lastUpdatedAt: number;
}

export class LayoutStore {
  windows: AppWindow[] = [];
  buriedSessions: import('@shared/domain').AppSession[] = [];
  lastUpdatedAt = 0;

  constructor() {
    makeAutoObservable(this);
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
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }
}
