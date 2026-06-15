// Decides whether the running app should check a static update feed, and against which URL,
// from the two facts that gate it: whether the build is packaged, and the feed URL baked in
// at make time. Pure: it reads no global state — main.ts passes both facts and performs the
// effect (setFeedURL + checkForUpdates) only when this returns `enabled`. [LAW:effects-at-boundaries]

/**
 * The decision. `enabled` cannot exist without a non-empty feed URL, so the effect boundary
 * never has to re-check the URL it was handed. [LAW:types-are-the-program]
 */
export type UpdaterDecision =
  | { kind: 'disabled'; reason: string }
  | { kind: 'enabled'; feedUrl: string };

export interface UpdaterInputs {
  /** `app.isPackaged` — electron-updater only operates inside a packaged build. */
  readonly isPackaged: boolean;
  /** The feed URL baked in via `WORKBENCH_UPDATE_FEED_URL`; empty string when unset. */
  readonly feedUrl: string;
}

/**
 * Resolve autoupdate behavior:
 * - dev run (not packaged)      → disabled (electron-updater throws outside a packaged app)
 * - packaged, no feed URL baked → disabled, naming the missing build variable
 * - packaged, feed URL present  → enabled against that URL
 *
 * Disabling is always explicit and carries a reason so a build that silently never updates
 * is distinguishable from one deliberately built without a feed. [LAW:no-silent-failure]
 */
export function resolveUpdaterConfig({ isPackaged, feedUrl }: UpdaterInputs): UpdaterDecision {
  if (!isPackaged) {
    return {
      kind: 'disabled',
      reason: 'app is not packaged (dev run); electron-updater only runs in a packaged build',
    };
  }
  const url = feedUrl.trim();
  if (!url) {
    return {
      kind: 'disabled',
      reason: 'no update feed URL baked into this build (WORKBENCH_UPDATE_FEED_URL was unset at make time)',
    };
  }
  return { kind: 'enabled', feedUrl: url };
}
