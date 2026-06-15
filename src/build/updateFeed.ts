// Build-time logic that turns the macOS .zip `make` produced into electron-updater's
// static feed manifest (`latest-mac.yml`). electron-forge has no static-feed publisher,
// so the manifest is generated here. Pure: this module performs no IO — it decides which
// artifacts get a manifest and serializes the manifest value; the build boundary reads the
// zip (to measure its hash and size) and writes the file. [LAW:effects-at-boundaries]
//
// The manifest is derived from the zip and explicitly synchronized at build time — the zip
// is the source of truth, the manifest is a checksum-bearing index of it. [LAW:one-source-of-truth]

import path from 'node:path';
import { stringify } from 'yaml';

// electron-updater's macOS generic provider fetches `<feedUrl>/latest-mac.yml`.
const CHANNEL_FILE = 'latest-mac.yml';

// On macOS electron-updater downloads the .zip (not the DMG, which is first-install only)
// and verifies it against the manifest's sha512. Only .zip artifacts get a manifest.
const isMacZip = (artifact: string): boolean => path.extname(artifact).toLowerCase() === '.zip';

/** One macOS .zip to publish, plus where its `latest-mac.yml` manifest belongs. */
export interface UpdateFeedPlan {
  readonly zipPath: string;
  readonly ymlPath: string;
}

/**
 * Plan the feed manifests to emit from the artifacts `make` produced: one manifest per
 * macOS .zip, written alongside its zip so each `out/make/zip/darwin/<arch>/` directory is
 * a self-contained per-architecture feed. Non-zip artifacts (DMG, Squirrel, deb/rpm) yield
 * nothing.
 */
export function planUpdateFeed(artifacts: readonly string[]): UpdateFeedPlan[] {
  return artifacts.filter(isMacZip).map((zipPath) => ({
    zipPath,
    ymlPath: path.join(path.dirname(zipPath), CHANNEL_FILE),
  }));
}

/**
 * The measured facts about one zip needed to describe it in a feed manifest. `sha512` is
 * base64-encoded (the encoding electron-updater compares against), `size` is the byte
 * length, and `releaseDate` is stamped at the build boundary — all supplied as values so
 * this serializer stays pure and deterministic.
 */
export interface UpdateFeedEntry {
  readonly version: string;
  readonly fileName: string;
  readonly sha512: string;
  readonly size: number;
  readonly releaseDate: string;
}

/**
 * Serialize a `latest-mac.yml` matching builder-util-runtime's `UpdateInfo` shape. The
 * `files` array is the field electron-updater's MacUpdater reads; top-level `path` and
 * `sha512` are the legacy single-file fields it still falls back to. All three name the
 * same zip, so the manifest cannot describe a file it doesn't checksum.
 */
export function buildLatestMacYml(entry: UpdateFeedEntry): string {
  return stringify({
    version: entry.version,
    files: [{ url: entry.fileName, sha512: entry.sha512, size: entry.size }],
    path: entry.fileName,
    sha512: entry.sha512,
    releaseDate: entry.releaseDate,
  });
}
