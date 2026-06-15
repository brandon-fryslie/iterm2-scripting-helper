# Static-feed autoupdate

The packaged macOS app updates itself via [`electron-updater`](https://www.electron.build/auto-update)
pointed at a **static feed** — a plain directory served over HTTPS that holds the update
`.zip` and a `latest-mac.yml` manifest describing it. There is no update server to run: any
static host (S3, a Gitea/GitHub release, nginx, an object store) works.

On macOS `electron-updater` consumes the **`.zip`** (via `@electron-forge/maker-zip`), not the
`.dmg`. The DMG is the first-install deliverable; the zip is what every subsequent in-app
update downloads and unpacks. Both wrap the same signed+notarized `.app`, and **autoupdate
requires that signing** — Squirrel.Mac (which `electron-updater` drives under the hood) only
swaps in an update whose app signature matches the installed one. See `docs/macos-signing.md`.

## What `pnpm make` produces

Alongside each macOS `.zip`, the `postMake` hook in `forge.config.ts` writes a `latest-mac.yml`
into the same `out/make/zip/darwin/<arch>/` directory:

```yaml
version: 0.1.0
files:
  - url: iTerm2 Scripting Workbench-darwin-arm64-0.1.0.zip
    sha512: <base64 sha512 of the zip>
    size: <byte length of the zip>
path: iTerm2 Scripting Workbench-darwin-arm64-0.1.0.zip
sha512: <base64 sha512 of the zip>
releaseDate: <ISO-8601 timestamp>
```

The manifest is **derived from the zip** — its `sha512` (base64) and `size` are measured from
the actual file at build time. The shape matches `builder-util-runtime`'s `UpdateInfo`, which
is what `electron-updater` parses. The `files` array is the field its macOS updater reads;
top-level `path`/`sha512` are the legacy single-file fields it falls back to. All name the
same zip, so the manifest can never advertise a file it doesn't checksum.

The generator is split the same way the signing code is:

- `src/build/updateFeed.ts` (`planUpdateFeed`, `buildLatestMacYml`, unit-tested) is pure: it
  decides which artifacts get a manifest and serializes the manifest value. It performs no IO.
- The `postMake` hook is the effect boundary: it reads each zip, computes the hash and size,
  stamps `releaseDate`, and writes the file.

> Spaces in the filename (the product name has them) are fine — `electron-updater` builds the
> download URL with the WHATWG `URL` constructor, which percent-encodes them (`%20`). Serve the
> file at its literal name and standard static hosting resolves the encoded request.

## Configuring the feed URL

The feed URL is **baked into the build** at `make` time from `WORKBENCH_UPDATE_FEED_URL`
(via a Vite `define` in `vite.main.config.mts`). A build knows its own update channel.

```sh
export WORKBENCH_UPDATE_FEED_URL="https://updates.example.com/workbench/arm64/"
pnpm make    # plus the APPLE_* signing vars for a real, updatable build
```

At launch the app logs the resolved decision:

- `[updater] checking <url> for updates` — packaged build with a feed URL baked in.
- `[updater] disabled: app is not packaged …` — a `pnpm start` dev run (electron-updater only
  runs inside a packaged app).
- `[updater] disabled: no update feed URL baked into this build …` — packaged, but
  `WORKBENCH_UPDATE_FEED_URL` was unset at make time.

A build with no feed URL **disables autoupdate explicitly and says so** rather than failing at
runtime. The decision logic lives in `src/main/updaterConfig.ts` (`resolveUpdaterConfig`,
unit-tested); `main.ts` performs the `setFeedURL` + `checkForUpdates` effect only when it
returns `enabled`.

## Hosting

Upload the contents of the arch's `out/make/zip/darwin/<arch>/` directory — the `.zip` and its
`latest-mac.yml` — to the directory the feed URL points at. `electron-updater` fetches
`<feedUrl>/latest-mac.yml`, compares its `version` to the running app's, and if newer downloads
and verifies the `.zip` against the manifest's `sha512`.

### One feed URL per architecture

Each `make` run produces a single-architecture zip and a `latest-mac.yml` that names **only
that zip**. Serve each architecture from its **own** feed URL (e.g. `…/arm64/` and `…/x64/`)
and bake the matching URL into each build. Pointing both architectures at one shared feed
directory would have the second upload's manifest overwrite the first's, handing the wrong-arch
zip to half your users. A single unified multi-arch feed (one `latest-mac.yml` listing both
arch zips) is a possible future enhancement, not what this generates today.

> No `.blockmap` is generated, so updates are full downloads rather than differential. This is
> `electron-updater`'s documented fallback and works correctly; it just transfers the whole zip
> each time.

## Verifying the manifest (acceptance)

After `pnpm make`, confirm the manifest matches the zip it describes:

```sh
DIR=out/make/zip/darwin/arm64
ZIP=$(ls "$DIR"/*.zip)
cat "$DIR/latest-mac.yml"
openssl dgst -sha512 -binary "$ZIP" | openssl base64 -A; echo   # must equal the manifest sha512
stat -f%z "$ZIP"                                                # must equal the manifest size
```

End-to-end (a running app discovering and applying a newer version) additionally requires two
signed builds and a reachable host, and is exercised at release time.
