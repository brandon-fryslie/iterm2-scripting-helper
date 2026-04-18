import { makeAutoObservable } from 'mobx';

export interface DynamicProfileFile {
  path: string;
  basename: string;
  mtime: number;
  size: number;
  body: string;
  parseError: string | null;
  topLevelKeys: string[];
  profileCount: number;
}

export interface DynamicProfileSnapshot {
  folder: string;
  folderExists: boolean;
  files: DynamicProfileFile[];
  lastError: string | null;
}

export class DynamicProfileStore {
  folder = '';
  folderExists = false;
  lastError: string | null = null;
  private readonly files = new Map<string, DynamicProfileFile>();

  constructor() {
    makeAutoObservable(this);
  }

  setFolder(folder: string, exists: boolean): void {
    this.folder = folder;
    this.folderExists = exists;
  }

  upsertFile(file: DynamicProfileFile): void {
    this.files.set(file.path, file);
  }

  removeFile(path: string): void {
    this.files.delete(path);
  }

  clear(): void {
    this.files.clear();
  }

  setError(err: string | null): void {
    this.lastError = err;
  }

  snapshot(): DynamicProfileSnapshot {
    const files = Array.from(this.files.values())
      .map((f) => ({
        path: f.path,
        basename: f.basename,
        mtime: f.mtime,
        size: f.size,
        body: f.body,
        parseError: f.parseError,
        topLevelKeys: [...f.topLevelKeys],
        profileCount: f.profileCount,
      }))
      .sort((a, b) => a.basename.localeCompare(b.basename));
    return {
      folder: this.folder,
      folderExists: this.folderExists,
      files,
      lastError: this.lastError,
    };
  }
}
