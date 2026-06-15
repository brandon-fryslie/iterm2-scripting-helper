# macOS code signing & notarization

The Electron Forge build signs and notarizes the macOS app **only when** Apple
credentials are present in the environment. With no credentials set, `pnpm package` /
`pnpm make` produce an unsigned local build — which is what you want for day-to-day
development. The credential logic lives in `src/build/macSigning.ts` (unit-tested) and is
wired into `forge.config.ts`.

## The three environment variables

Signing uses Apple's app-specific-password notarization method. All three must be set
together; setting some but not all is treated as a misconfiguration and **fails the build
loudly** rather than silently emitting an unsigned artifact.

| Variable            | What it is                                                                 |
| ------------------- | -------------------------------------------------------------------------- |
| `APPLE_ID`          | The Apple Developer account email.                                         |
| `APPLE_ID_PASSWORD` | An **app-specific password** for that Apple ID (not the account password). |
| `APPLE_TEAM_ID`     | The Developer Team ID (e.g. `ABCDE12345`).                                 |

The signing identity itself is **not** an env var: `@electron/osx-sign` auto-discovers the
`Developer ID Application: … (TEAMID)` certificate from the login keychain. That
certificate must be installed on the build machine.

## One-time setup for a signed build

1. **Apple Developer Program membership** — required to issue a Developer ID certificate.
2. **Developer ID Application certificate** — create it in the Apple Developer portal (or
   via Xcode → Settings → Accounts → Manage Certificates → `+` → *Developer ID
   Application*) and ensure it lands in your login keychain. Confirm with:
   ```sh
   security find-identity -v -p codesigning | grep "Developer ID Application"
   ```
3. **App-specific password** — generate at <https://account.apple.com> → Sign-In and
   Security → App-Specific Passwords. This becomes `APPLE_ID_PASSWORD`.
4. **Team ID** — find it at <https://developer.apple.com/account> under Membership
   details. This becomes `APPLE_TEAM_ID`.

## Producing a signed, notarized build

```sh
export APPLE_ID="you@example.com"
export APPLE_ID_PASSWORD="abcd-efgh-ijkl-mnop"   # app-specific password
export APPLE_TEAM_ID="ABCDE12345"
pnpm package    # or: pnpm make
```

On start, Forge logs which mode it resolved:

- `[forge] macOS signing ENABLED — notarizing as …` — credentials found.
- `[forge] macOS signing DISABLED …` — no credentials; unsigned build.

Notarization uploads the signed app to Apple and waits for the ticket, so a signed build
takes noticeably longer than an unsigned one and requires network access.

## CI

To sign in CI, provide the three variables as secrets and import the Developer ID
certificate into a keychain on the runner before `pnpm make`. The certificate import step
is intentionally **not** automated here — it depends on how the `.p12` and its password
are stored as secrets.

## Verifying a build (acceptance)

```sh
APP="out/iTerm2 Scripting Workbench-darwin-arm64/iTerm2 Scripting Workbench.app"
codesign --verify --deep --strict --verbose=2 "$APP"   # signature valid
spctl --assess --type execute --verbose "$APP"          # Gatekeeper: accepted
xcrun stapler validate "$APP"                           # notarization ticket stapled
```

The epic's acceptance criterion — *a notarized DMG installs on a clean macOS machine* — is
met when these three checks pass on a machine that never saw the signing certificate.
