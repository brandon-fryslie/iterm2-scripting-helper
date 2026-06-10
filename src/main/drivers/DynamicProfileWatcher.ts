import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { DynamicProfileStore, DynamicProfileFile } from '../stores/DynamicProfileStore';

export const DYNAMIC_PROFILES_FOLDER = path.join(
  os.homedir(),
  'Library/Application Support/iTerm2/DynamicProfiles',
);

export class DynamicProfileWatcher {
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly store: DynamicProfileStore,
    private readonly folder: string = DYNAMIC_PROFILES_FOLDER,
  ) {
    this.store.setFolder(this.folder, existsSync(this.folder));
  }

  async start(): Promise<void> {
    if (this.watcher) return;
    const exists = existsSync(this.folder);
    this.store.setFolder(this.folder, exists);
    if (!exists) {
      this.store.setError(`folder not found: ${this.folder}`);
      return;
    }

    this.watcher = chokidar.watch(this.folder, {
      ignoreInitial: false,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
    });
    this.watcher.on('add', (p) => void this.handleChange(p));
    this.watcher.on('change', (p) => void this.handleChange(p));
    this.watcher.on('unlink', (p) => this.store.removeFile(p));
    this.watcher.on('error', (err) => this.store.setError(String(err)));
  }

  async stop(): Promise<void> {
    if (!this.watcher) return;
    await this.watcher.close();
    this.watcher = null;
  }

  async refresh(): Promise<void> {
    if (!existsSync(this.folder)) {
      this.store.setFolder(this.folder, false);
      this.store.clear();
      return;
    }
    this.store.setFolder(this.folder, true);
    const entries = await fs.readdir(this.folder);
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      await this.handleChange(path.join(this.folder, name));
    }
  }

  private async handleChange(filePath: string): Promise<void> {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return;
      const body = await fs.readFile(filePath, 'utf8');
      const entry: DynamicProfileFile = {
        path: filePath,
        basename: path.basename(filePath),
        mtime: stat.mtimeMs,
        size: stat.size,
        body,
      };
      this.store.upsertFile(entry);
    } catch (err) {
      this.store.setError(`failed to read ${filePath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async writeFile(basename: string, body: string): Promise<string> {
    if (!existsSync(this.folder)) {
      await fs.mkdir(this.folder, { recursive: true });
      this.store.setFolder(this.folder, true);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(basename)) {
      throw new Error(`invalid basename: ${basename}`);
    }
    const full = path.join(this.folder, basename);
    await fs.writeFile(full, body, 'utf8');
    await this.handleChange(full);
    return full;
  }

  async deleteFile(basename: string): Promise<void> {
    const full = path.join(this.folder, basename);
    await fs.unlink(full).catch(() => void 0);
    this.store.removeFile(full);
  }
}
