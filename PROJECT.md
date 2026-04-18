# iTerm2 Scripting Helper — Project Proposal

An Electron desktop application that gives complete visibility into — and interactive tooling for — every scriptable surface iTerm2 exposes. The app is a scripting IDE, protocol inspector, extension workbench, and live debugger rolled into one.

Its guiding claim: **if iTerm2 can observe it, emit it, or be told to do it, this app can show it, generate it, or drive it**.

---

## 1. Motivation

iTerm2 is the most scriptable terminal on macOS, but that scriptability is scattered across at least eight disjoint surfaces (Python API, AppleScript/JXA, Dynamic Profiles JSON, OSC 1337 / OSC 133 escape sequences, shell integration, tmux integration, the `.sdef` dictionary, Cocoa preferences plists). The official Python library documents the happy path for each; none of them surface the *system* — what's currently subscribed, what RPCs are registered, what notifications are flowing, what the last wire message looked like, what the variable tree currently holds.

A scripting helper should collapse all of those surfaces into one reactive view and one toolbox:

- **Observability** — live view of every notification, variable, subscription, registration, profile mutation, and raw protobuf frame.
- **Exploration** — browse the full surface area (34 request types, 13 notification types, 4 RPC roles, ~hundreds of profile keys, ~30 OSC sub-commands, full variable tree) in an indexed, searchable, documented tree.
- **Authoring** — generate valid escape sequences, build triggers with live-tested regexes, design status bar components with real knobs, produce Dynamic Profile JSON, draft RPC skeletons, encode profile patches.
- **Testing & Debug** — attach to any session, stream its screen, filter its keystrokes, replay wire traffic, diff profiles, inject bytes, fire transactions.

The app's audience is anyone extending iTerm2 seriously: writers of custom status bar components, Dynamic Profile emitters, tmux bridge authors, and terminal-feature researchers.

---

## 2. Architectural Principles

The proposal is built on the architectural laws declared in the project's global rules. They are not style guidance; they shape the whole design.

- **Dataflow, not control flow.** The app is a pipeline: two drivers (`ProtocolDriver`, `AppleScriptDriver`) emit into typed streams → stores accumulate → React renders. Operations execute on every frame; variability lives in notification payloads, never in whether code paths run.
- **One source of truth.** Each domain (sessions, profiles, variables, subscriptions, registrations, wire log, etc.) has exactly one MobX store. Rendered views derive — never cache or duplicate.
- **Single enforcer.** Protocol framing, auth header injection, and `id` correlation are enforced only in `ProtocolDriver`. No other module speaks protobuf or WebSocket.
- **One-way dependencies.** Renderer → IPC bridge → Main → drivers → OS. Stores expose observables upward; they receive only driver events downward. No upward call from driver into renderer except through the event stream.
- **One type per behavior.** The 12 Python `Monitor` classes (`KeystrokeMonitor`, `PromptMonitor`, `VariableMonitor`, …) collapse into **one** generic `Subscription<K extends NotificationKind>` parameterized by the notification enum.
- **Verifiable goals.** Every milestone terminates in a concrete, machine-checkable acceptance criterion (specific protobuf round-trip, specific store state, specific rendered DOM query). No "the user can explore X" deliverables.

---

## 3. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| App shell | **Electron** (latest stable) + **Electron Forge** | Required; Forge chosen for signed/notarized macOS builds out of the box |
| Renderer framework | **React 18** + TypeScript | Required |
| Component system | **shadcn/ui** + Tailwind + Radix primitives | Required; shadcn gives owned, editable components — good fit for a deeply customized workbench |
| State | **MobX 6** (+ `mobx-react-lite`) | Required; map-and-observable model fits the "notifications mutate stores, views observe" dataflow exactly |
| Tabs / panes / layout | **Radix Tabs** + **react-resizable-panels** | Draggable panes for docking tools side-by-side |
| Code editor | **Monaco** (JSON/Python/JS highlighting, diff view) | Powers Profile editor, Dynamic Profile authoring, script console |
| Terminal preview | **xterm.js** | Renders streamed screen contents in the Screen Inspector |
| Wire protocol | **`@bufbuild/protobuf`** + **`buf`** codegen against `proto/api.proto` | Strongly-typed messages; proto2 support; small runtime |
| WebSocket | **`ws`** | `ws+unix://` required (see §6.1 on the "Application Support" path workaround) |
| AppleScript | `child_process.execFile('/usr/bin/osascript', …)` | Cookie bootstrap only |
| Filesystem watching | **`chokidar`** | For `DynamicProfiles/` and `Scripts/` folders |
| IPC | Electron `ipcMain.handle` + `contextBridge` preload, typed via a shared `RpcSchema` | All cross-process calls go through one registry |
| Testing | **Vitest** (unit) + **Playwright Electron** (end-to-end) | Playwright drives the real packaged app against a real iTerm2 |

---

## 4. System Architecture

```
┌─────────────────────────── Electron Main ────────────────────────────┐
│                                                                      │
│   ┌──────────────────┐       ┌──────────────────┐                    │
│   │ AppleScriptDriver│       │  ProtocolDriver  │                    │
│   │  osascript spawn │       │  ws+unix client  │                    │
│   │  cookie/key pair │──┐    │  protobuf codec  │                    │
│   │  .sdef introspect│  │    │  id-correlation  │                    │
│   └──────────────────┘  │    └────────┬─────────┘                    │
│                         │             │                              │
│                         ▼             ▼                              │
│              ┌──────────────────────────────┐                        │
│              │     ConnectionOrchestrator   │  manages handshake,    │
│              │   cookie → socket → ready    │  reconnect, backoff    │
│              └──────────┬───────────────────┘                        │
│                         │                                            │
│   ┌─────────────────────┼──────────────────────────────────────┐    │
│   │ Store hub (owned by main; mirrored to renderer via IPC)   │    │
│   │   ConnectionStore  LayoutStore    VariableStore           │    │
│   │   ProfileStore     TriggerStore   ArrangementStore        │    │
│   │   SubscriptionStore RegistrationStore  WireLogStore        │    │
│   │   NotificationHub  ScreenStreamStore  MenuStore           │    │
│   │   BroadcastStore   TmuxStore          ColorPresetStore    │    │
│   │   PreferencesStore DynamicProfileStore                    │    │
│   └───────────────────┬──────────────────────────────────────┘    │
│                       │                                              │
│   ┌───────────────────┴──────────────────────────────┐              │
│   │  FilesystemWatchers (DynamicProfiles, Scripts)   │              │
│   └──────────────────────────────────────────────────┘              │
│                                                                      │
└─────────────────────────────┬────────────────────────────────────────┘
                              │ typed IPC (request/response + event bus)
                              ▼
┌───────────────────────── Electron Renderer ─────────────────────────┐
│                                                                     │
│  Shell (react-resizable-panels)                                     │
│   ├─ Top tabs: Monitor │ Workbench │ Console │ Settings             │
│   ├─ Main: the active tab's workspace (dockable panes in Monitor,   │
│   │        artifact editor in Workbench, action palette in Console) │
│   └─ Footer: live connection status, subscription count, wire rate  │
│                                                                     │
│  MobX store proxies (read-only mirrors of main-process stores;      │
│    write operations go through IPC)                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.1 Why the drivers live in main

1. Subscriptions must outlive renderer-window lifecycle (close the window, keep monitoring).
2. `child_process`, `fs`, and the Unix domain socket need Node primitives.
3. One connection serves multiple renderer windows (primary + popouts).
4. The cookie — transient secret — must never cross into the renderer.

### 4.2 IPC schema (sketch)

```ts
type RpcSchema = {
  'connection/connect': { args: {}; result: ConnectionState };
  'connection/disconnect': { args: {}; result: void };
  'wire/send': { args: ClientOriginatedMessage; result: ServerOriginatedMessage };
  'wire/history': { args: { limit: number }; result: WireFrame[] };
  'subscribe': { args: SubscribeSpec; result: SubscriptionToken };
  'unsubscribe': { args: SubscriptionToken; result: void };
  'store/snapshot': { args: { store: StoreKey }; result: unknown };
  // …one entry per domain operation
};
```

Events flowing the other direction (main → renderer) are a single channel with a discriminated-union payload: `{ kind: 'notification' | 'store-patch' | 'wire-frame'; data: … }`. One channel keeps ordering guarantees simple.

---

## 5. Feature Map — Three Tabs + Settings

The whole application is **three** top-level tabs plus a Settings drawer, each aligned to a verb the user is performing:

| Tab | Verb | Question it answers |
|---|---|---|
| **Monitor** | observe | "What is iTerm2 doing right now, and why?" |
| **Workbench** | author | "I'm building a thing — edit it, preview it, ship it." |
| **Console** | drive | "Make iTerm2 do this one thing, now." |
| **Settings** | configure | "How is the app connected, and what can this iTerm2 do?" |

Every scripting surface from the research (34 request types, 13 notification types, 4 RPC roles, ~hundreds of profile keys, ~30 OSC sub-commands, full variable tree, Dynamic Profiles folder, tmux, AppleScript, shell integration) lands in **one** of these tabs. Nothing is duplicated. Nothing has its own tab.

### 5.1 Monitor — the live observatory

One dashboard, dockable panes (`react-resizable-panels`). The user arranges the panes they care about; the layout is persisted per-workspace. A single global filter bar at the top cross-scopes everything by session, by time window, and by notification kind.

**Available panes** (each is a reactive view over a store; opening a pane subscribes, closing unsubscribes — refcounted via `SubscriptionStore`):

- **Layout** — live window → tab → session → split tree from `LayoutStore`. Click a session to make it the focus for all other panes.
- **Screen** — `xterm.js` render of the focused session's buffer via `ScreenStreamer`; styled-cell inspector; side-by-side diff against last snapshot; "capture as fixture" button.
- **Variables** — the full `session.* / tab.* / window.* / app.* / user.*` tree with live values; pin any path to a watchlist that flashes on change.
- **Notifications** — firehose of all 13 notification kinds with per-kind filter chips, pause/replay scrubber, export as NDJSON.
- **Wire** — raw protobuf frame log; decoded + hex views; search by `id` or type; pairs each request with its response; "save frame as fixture" hook.
- **Keystrokes** — live keystroke stream with modifier/keycode decode; "advanced" toggle surfaces KEY_UP and FLAGS_CHANGED.
- **Prompts** — table of shell-integration prompts with command text, start/end timestamps, exit code, durations.
- **Focus** — app/window/tab/session focus timeline.
- **Registrations** — which RPCs / status bar components / title providers / context menus / toolbelt tools this app currently has registered (live/dead state on reconnect).

**Cross-pane behaviour**: selecting any entity in one pane propagates as the "focus" for the others. Click a session in Layout → Screen, Variables, Keystrokes, Prompts all scope to it. Click a wire frame → Notifications scrolls to the matching event, if any. This is the main reason the old "tab-per-type" layout was wrong: these panes are useful *together*, not apart.

### 5.2 Workbench — the authoring surface

Left rail lists **artifact types**. Picking one opens its gallery (existing instances + "new"). Selecting an artifact opens the editor in the main pane with a live preview panel on the right.

**Artifact types** (each is a consistent three-part pattern — editor on the left, preview/test harness on the right, wire/install hooks at the bottom):

- **Profile** — full editor for the hundreds of profile keys, organized by the same sections iTerm2's own preferences use (Colors / Text / Window / Terminal / Session / Keys / Advanced); diff-vs-default; bulk-apply across profiles matching a filter; live preview renders a sample session with the profile applied.
- **Dynamic Profile** — Monaco JSON editor + schema validation; parent-GUID/name resolution preview; drop into `DynamicProfiles/` with one click; chokidar hot-reload means editing in the app and editing the file externally stay in sync.
- **Trigger** — regex tester runs the pattern against the focused session's captured buffer; catalog of all 26 regex triggers + 11 event triggers; interpolated-strings mode toggle; preview shows what action fires when the pattern matches.
- **Status Bar Component** — knob designer (Checkbox / String / PositiveFloat / Color), icon uploader (PNG pairs), exemplar field, cadence slider, HTML vs. plain text picker; right pane shows the component rendered live in the current session's status bar via `RPCRegistrationRequest`.
- **Title Provider / Context Menu Provider** — same shape: design → register → preview with a live session assigned.
- **Toolbelt Tool** — URL, identifier, reveal-on-click; preview opens the tool in a sandboxed WebView frame.
- **RPC** — signature editor (name, typed args with defaults, role=GENERIC); TypeScript body in Monaco; invocations from iTerm2 (key binding, trigger, menu item, `invoke_function`) stream into the preview as live calls; "export as Python stub" button for users who want to move it into `Scripts/`.
- **Arrangement** — save/restore/diff over `SavedArrangementStore`; JSON inspector; apply to a new window.
- **Escape Sequence Template** — composable form for OSC 1337 / 133 / 8 / CSI (30+ sub-commands: `SetMark`, `CurrentDir`, `File`, `Custom`, `Block`, `Button`, `SetColors`, `SetUserVar`, `CopyToClipboard`, `RequestAttention`, `Hyperlink`, `PromptStart/End`, …). Templates are saved, named, parameterized with variables, emitted either to a session or to the clipboard. The subscription side — `CustomControlSequenceMonitor` — lives here too, next to the emitter that produces the matching `Custom=` sequences.
- **Key Bindings & Snippets** — global bindings editor backed by `binding.py`'s encode/decode; paste configurations; snippet identifiers.
- **Broadcast Domain** — visual drag-and-drop session→domain editor.

The three-part shape is the **single abstraction** for authoring anything. Adding a future artifact type (say, an AI-feature prompt template) means one more entry in the left rail — not a new tab.

### 5.3 Console — the interactive driver

A session picker at the top locks the action scope. Below it, an **action palette** — a keyboard-driven command-bar (⌘K) plus a grid of action buttons — dispatches one-off operations. A transcript below records every action with its request, response, latency, and any resulting notifications, scrollable and replayable.

**Actions** (one row in the palette per entry; each expands to a small inline form):

- **Send text** — `SendTextRequest` with `suppress_broadcast` toggle.
- **Inject bytes** — `InjectRequest` with hex editor and ANSI preview.
- **Activate** — `ActivateRequest` with all flags.
- **Fire escape sequence** — inline-picked from the Workbench template library, or composed ad hoc.
- **Execute menu item** — identifier autocomplete from the menu-id manifest + state read-back.
- **Invoke function** — call any registered or built-in function (`window.set_title`, `session.run_coprocess`, user RPCs) with typed args.
- **Set profile property / Set property** — JSON-valued; per-session or by GUID list.
- **Select / Get selection** — range editor.
- **Begin/end transaction** — freeze the iTerm2 main loop while queueing further actions.
- **Run AppleScript / JXA** — osascript console with sdef autocomplete; shows the parallel protobuf call below the result.
- **tmux command** — list connections + raw command sender + create native tmux-backed window.
- **Color preset** — apply preset to profile or session.
- **Restart / Close** — `RestartSessionRequest`, `CloseRequest`.
- **Arrangement** — save / restore.
- **Raw protobuf** — paste a `ClientOriginatedMessage` (JSON or protobuf hex), fire; for when no typed form exists yet.

Every action in Console is also available as a template-able **Snippet** that can be named, parameterized, and saved. A saved snippet is equivalent to a shell one-liner — one click re-fires it.

### 5.4 Settings — configuration & reference

A small, dense tab. Not a feature.

- **Connection** — socket path state, protocol version, handshake headers sent/received, cookie age, reconnect controls, latency ping.
- **Authorization** — cookie/key state, TCC automation grant check, `disable-automation-auth` sentinel check, re-request cookie (with `reusable` TTL picker).
- **Capability Report** — green/red matrix of feature availability for the connected iTerm2.
- **Preferences** — typed browser over the `PreferenceKey` enum; read/patch/diff-vs-baseline (app-level iTerm2 preferences, not app settings).
- **App preferences** — theme, store ring-buffer sizes, default ScreenStreamer cadence, subscription auto-reconnect.
- **Docs index** — searchable cross-reference of Python API / protobuf schema / sdef / OSC catalog with deep links that open the right Workbench editor or fire the right Console action.

---

## 6. Wire Layer Deep Dive

### 6.1 Transport

- Socket: `~/Library/Application\ Support/iTerm2/private/socket` (Unix domain, `0600`).
- Node's `ws` library URL-encodes `Application Support` → `Application%20Support` and fails the connect. Workaround: symlink `/tmp/iterm2-<pid>.sock` → real socket at startup, connect through the symlink. (Proven pattern; both `iterm2-typescript` and `MCPretentious` use it.)
- WebSocket subprotocol: `api.iterm2.com`.
- Required handshake headers (any missing one fails with HTTP 406):
  - `Origin: ws://localhost/`
  - `Host: localhost:0`
  - `Sec-WebSocket-Protocol: api.iterm2.com`
  - `x-iterm2-library-version: <lang> <version>` — **mandatory**; iTerm2 parses `<version>` as NSDecimalNumber and rejects below a minimum when `<lang>` is `python`. We send `node <version>` so the version floor does not apply.
  - `x-iterm2-advisory-name: iTerm2 Scripting Helper` — shown in iTerm2's Scripts console.
  - `x-iterm2-cookie: <cookie>`, `x-iterm2-key: <key>` — supplied once auth is complete.
  - `x-iterm2-disable-auth-ui: true` — optional; skip the in-iTerm2 permission dialog when we already hold a cookie.

### 6.2 Framing

One binary WebSocket frame = one serialized `ClientOriginatedMessage` (or `ServerOriginatedMessage` in reply / push). No length prefix, no batching. The `id: int64` field on each message is the correlation token — client chooses, server echoes on the matching response. Notifications arrive with no `id` on tag 1000.

### 6.3 The `ProtocolDriver` (single enforcer)

```ts
class ProtocolDriver {
  private ws: WebSocket;
  private pending = new Map<bigint, (msg: ServerOriginatedMessage) => void>();
  private notifications = new Emitter<NotificationKind, NotificationPayload>();
  private nextId = 1n;

  send<R extends RequestKind>(
    kind: R,
    payload: RequestPayload<R>,
  ): Promise<ResponsePayload<R>> { /* id++, put in pending, write frame */ }

  subscribe<K extends NotificationKind>(
    kind: K,
    args: SubscribeArgs<K>,
    handler: (n: NotificationPayload<K>) => void,
  ): Promise<SubscriptionToken> { /* wraps NotificationRequest */ }
}
```

This is the *only* module in the codebase that:
- constructs or parses protobuf messages,
- writes or reads WebSocket frames,
- allocates request `id`s,
- handles reconnect/backoff.

Every store, every tab, every feature reaches the wire only through this driver. Violating this boundary is a `LAW:single-enforcer` violation and must be flagged in review.

### 6.4 Authorization flow

```
1. detect(socketPath) ──► exists?  no ──► "iTerm2 not running / API disabled" prompt
2. osascript(getCookie) ──► "<cookie> <key>" string
3. connect(ws+unix, headers including cookie+key) ──► upgraded
4. if 401/403 ──► show re-auth flow with "reusable" toggle and Always-Allow-All-Apps hint
5. else ──► ready state, fire `connection/ready` event
6. on ws close ──► back to step 1 with exponential backoff (cap 30s)
```

Cookie is **never persisted to disk**. It lives in `ConnectionStore.cookie: string | null` in main-process memory only. Renderer never receives it. On iTerm2 restart, cookie is re-requested.

---

## 7. Store Model

Every store is a plain MobX `observable` class in the main process. Stores are serialized and mirrored to the renderer via a `store/patch` IPC event bus. The renderer's proxy stores are read-only observables that the UI binds to; writes go through typed IPC methods.

| Store | Content | Upstream |
|---|---|---|
| `ConnectionStore` | socket path, protocol version, cookie age, handshake headers, latency | `ProtocolDriver` events |
| `LayoutStore` | full tree of windows → tabs → sessions → splits | `ListSessionsResponse` + `NOTIFY_ON_LAYOUT_CHANGE` |
| `VariableStore` | map keyed by `(scope, id)` → name → value | `NOTIFY_ON_VARIABLE_CHANGE` subscriptions, one per (scope, identifier) |
| `ProfileStore` | all profiles, indexed by GUID, typed profile schema | `ListProfilesResponse` + `NOTIFY_ON_PROFILE_CHANGE` |
| `DynamicProfileStore` | file list + parsed JSON, with validation errors per file | `chokidar` on `DynamicProfiles/` |
| `TriggerStore` | profile.id → decoded triggers + raw encodings | Derived from `ProfileStore`; writes encode back into a `SetProfilePropertyRequest` |
| `ArrangementStore` | list of named arrangements + their JSON | `SavedArrangementRequest` responses |
| `ColorPresetStore` | preset catalog | `ColorPresetRequest.list` |
| `BroadcastStore` | current domains | `NOTIFY_ON_BROADCAST_CHANGE` |
| `MenuStore` | generated menu-id manifest + last known state flags | Static data + `MenuItemRequest` state queries |
| `TmuxStore` | connections, per-connection windows | `TmuxRequest` + session tmux variables |
| `PreferencesStore` | `PreferenceKey` → value | `PreferencesRequest` |
| `SubscriptionStore` | live `Map<SubscriptionToken, SubscribeSpec>` | `ProtocolDriver` |
| `RegistrationStore` | `Map<identifier, RegistrationSpec>` keyed per role (RPC / title / status / context / tool) | `ProtocolDriver` |
| `ScreenStreamStore` | `Map<sessionId, ScreenSnapshot>` for sessions being watched | `ScreenStreamer` per session |
| `KeystrokeLogStore` | ring buffer of `KeystrokeNotification`s | `NOTIFY_ON_KEYSTROKE` |
| `PromptLogStore` | ring buffer of prompt/command events | `NOTIFY_ON_PROMPT` |
| `NotificationHub` | ring buffer of every notification (union type), for the Firehose tab | every notification kind, tee'd here |
| `WireLogStore` | ring buffer of every client-sent and server-received frame | `ProtocolDriver` tap |

Every log store is a fixed-size ring buffer (configurable cap: default 10 000 entries). Memory stays bounded. Exports use streaming NDJSON so we don't materialize the whole buffer.

---

## 8. Cross-Cutting Concerns

### 8.1 Interpolation Sandbox (shared component)

Many surfaces accept iTerm2's interpolated-string expressions (`\(session.hostname)`, `\(iterm2.user_input(...))`). The app ships one `<InterpolationEditor>` component that:

1. parses expressions client-side (best-effort, mirroring `iTermExpressionParser.m`'s grammar),
2. offers auto-complete against the live `VariableStore`,
3. evaluates via `InvokeFunctionRequest` with the current scope's context,
4. shows the rendered result beside the source.

Used in: Profile editor (title function, badge text, tab color, automatic profile switching rules, smart selection actions), Trigger editor (interpolated strings mode), Escape Sequence Workbench (variable-backed payloads), Status Bar Components designer.

### 8.2 Capability Gating

Every feature that depends on a particular iTerm2 version queries the `capabilities` module (ported from `capabilities.py`) at mount time. The UI renders a greyed "requires iTerm2 ≥ 3.x" chip rather than hiding the feature. No feature is silently skipped — `LAW:no-defensive-null-guards`.

### 8.3 Subscription Lifecycle

Tabs that subscribe (Screen Inspector, Variable watch, Keystroke log, etc.) register their subscriptions with `SubscriptionStore`, which holds a reference count per `(kind, args)`. When the last consumer unmounts, the store issues `async_unsubscribe`. This lets multiple tabs share a subscription (e.g., Screen Inspector + Wire Inspector both watching screen updates for the same session) without either duplicating the wire traffic or prematurely killing it.

### 8.4 Error Model

All driver errors surface as first-class events into a dedicated `ErrorStore`. The UI renders them in a toast layer and in a dedicated Errors tab. No silent catch blocks, no `|| null` fallbacks — a failed request failing loudly is the behavior, per the project's scripting-discipline rules.

### 8.5 Security

- Cookie never leaves main process memory.
- Preload script exposes a strict allowlist of IPC methods; no `ipcRenderer` global.
- `contextIsolation: true`, `nodeIntegration: false`.
- `CSP`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self';` — renderer does not talk to any network, local or remote.
- All WebSocket traffic is Unix-domain loopback to a 0600-mode socket owned by the user.

---

## 9. Milestones

Each milestone ends with a **concrete acceptance test** — a specific action against a real iTerm2 that must pass. Slices are vertical: every milestone ships a usable piece of Monitor, Workbench, or Console, not a horizontal scaffold layer.

### M0 — Scaffolding (3 days)
- Electron Forge template with TypeScript, React, Tailwind, shadcn, MobX wired.
- Playwright Electron harness, one smoke test.
- Typed IPC bridge (`RpcSchema`) plumbed end to end.
- Shell with Monitor / Workbench / Console / Settings tabs rendered from a stub config.

**Acceptance:** `npm test` passes in CI; `npm start` launches the four-tab shell; each tab renders a placeholder.

### M1 — Wire is alive (Settings + ProtocolDriver) (5 days)
- `buf generate` pipeline from `proto/api.proto`.
- `AppleScriptDriver.requestCookie()` via `osascript`.
- `ProtocolDriver.connect()` to `ws+unix://` with full header set; `send()` with `id` correlation; notification multiplexer; reconnect with backoff.
- Settings tab: Connection + Authorization panels functional; Capability Report live.

**Acceptance:** with iTerm2 running, clicking Connect negotiates the cookie, establishes the socket, fires a `ListSessionsRequest`, and Settings shows green status + protocol version + capability matrix.

### M2 — Monitor v1: Layout, Variables, Wire, Notifications (8 days)
- `LayoutStore`, `VariableStore`, `WireLogStore`, `NotificationHub`.
- `Subscription<K>` generic + ref-counting `SubscriptionStore`.
- Monitor tab with four dockable panes (Layout / Variables / Wire / Notifications); session-focus cross-linking between panes.

**Acceptance:** Opening a new iTerm2 window appears in the Layout pane within 250 ms; `echo $ITERM_SESSION_ID` mutates the corresponding value in Variables; every request/response shows in Wire with correct decoding; clicking a session in Layout filters Variables and Notifications to that session.

### M3 — Monitor v2: Screen, Keystrokes, Prompts, Focus (7 days)
- `ScreenStreamStore` with coalesced 16 ms forwarding; xterm.js renderer with styled-cell inspector.
- `KeystrokeLogStore` with advanced-mode toggle.
- `PromptLogStore` with OSC 133 start/end/exit-code capture.
- Focus timeline pane.

**Acceptance:** Running a command produces an `A/B/C/D` sequence in Prompts with correct exit-code readback; the Screen pane renders the live buffer of the focused session with fg/bg/style accuracy; keystrokes stream into the Keystrokes pane within a frame.

### M4 — Console v1 (6 days)
- Console tab scaffolding: session picker, action palette (⌘K), transcript, snippet save.
- Actions: Send text, Inject, Activate, Execute menu item, Invoke function, Restart/Close, Raw protobuf.

**Acceptance:** from Console, sending text into a session writes to it; activating a specific tab selects it in iTerm2; a saved snippet re-fires in one click.

### M5 — Workbench v1: Profiles + Dynamic Profiles + Escape Sequence Templates (10 days)
- Workbench tab shell with left-rail artifact picker + editor + preview pattern.
- Profile editor generated from proto + `profile.py` introspection; diff-vs-default; bulk apply.
- Dynamic Profile editor in Monaco with schema validation + chokidar hot-reload.
- Escape Sequence Template editor for OSC 1337 / 133 / 8 / CSI with the full sub-command catalog; emit-to-session or copy.

**Acceptance:** editing a color in a profile writes to the correct GUID and the session repaints within a frame; dropping a new Dynamic Profile JSON file surfaces in both iTerm2 and the app within 1 s; "Inline Image" template produces a valid `OSC 1337 ; File=inline=1 ; base64…` sequence that renders in the target session.

### M6 — Workbench v2: Triggers + Registrations (10 days)
- Trigger editor with regex tester against captured buffer; full 26-regex + 11-event catalog; interpolated-strings toggle.
- Registration editor (the three-part pattern) for all four RPC roles: generic RPC, status bar component (knobs/icons/cadence/HTML), title provider, context menu provider. Toolbelt tool registration as a fifth artifact.
- Custom Escape subscriber lives alongside the emitter in the Escape Sequence Template editor.

**Acceptance:** a status bar component with a Color knob registered from the Workbench appears in iTerm2's picker with working knob and live cadence; `CustomControlSequenceMonitor` payload fired from the emitter surfaces in the paired subscriber.

### M7 — Workbench v3 + Console v2: Arrangements, Broadcast Domains, Key Bindings, tmux, AppleScript, Selection, Preferences, Color Presets, Transactions (7 days)
- Artifacts: Arrangement, Broadcast Domain, Key Bindings & Snippets.
- Console actions: Fire escape sequence from template, Set profile property, Set/Get selection, Begin/end transaction, Run AppleScript, tmux command, Apply color preset, Save/restore arrangement.
- AppleScript console wired to `osascript` with sdef autocomplete.

**Acceptance:** every `ClientOriginatedMessage` request type is reachable from Console or Workbench with a captured round-trip in the Wire pane; an AppleScript expression's result shows alongside the equivalent protobuf form.

### M8 — Polish: Fixtures, Docs Index, Export-as-Python, Error Toasts (5 days)
- Fixture capture/replay: any wire-log span saves as a replayable NDJSON; the app has a "replay-only" mode for demos and tests.
- Docs Index in Settings with deep links that land on the right Workbench editor / Console action.
- "Export as Python stub" on every Workbench artifact that corresponds to a Python-side object (RPC, status bar, title, context menu).
- Toast layer + Errors pane for driver-level failures; no silent catches.

**Acceptance:** a recorded Monitor session replays deterministically against a disconnected UI; Docs search for "OSC 1337 SetMark" lands on the matching Template editor entry; an exported Python stub runs unchanged in `~/Library/Application Support/iTerm2/Scripts/`.

### M9 — Packaging & Distribution (3 days)
- Electron Forge macOS signing + notarization.
- DMG + zip publish; autoupdate via `electron-updater` against a static JSON feed.

**Acceptance:** notarized DMG installs on a clean macOS; first run negotiates a cookie against the installed iTerm2.

**Total: ~64 working days for a single developer to reach M9.**

---

## 10. Known Risks

1. **Proto schema drift.** iTerm2 additively extends `api.proto` across releases. Mitigation: lock a proto version per app release, pin the `X-iTerm2-Protocol-Version` the app was tested against, degrade gracefully for new enum values (proto2 `UNKNOWN` fallback), and surface a "server is newer than client" banner on version mismatch.
2. **AppleScript TCC (Automation permission).** On first cookie request macOS prompts for Automation permission. If the user denies, no cookie → no API. The Authorization tab must explain this explicitly and link to System Settings → Privacy & Security → Automation.
3. **Unix socket path URL encoding.** The `ws` library bug with spaces in the path is real. The `/tmp` symlink workaround is the mitigation. Playwright test must cover it.
4. **Status bar / title-provider registrations are per-connection.** When the app disconnects, iTerm2 removes the registered component. The UX must make this obvious; the Monitor → Registrations pane shows live/dead state, and re-registration happens on reconnect if the user chose "persist" on the Workbench artifact.
5. **Cookie loss on iTerm2 restart.** Cookies are in-memory in iTerm2. If iTerm2 restarts, the app must re-handshake. Orchestrator handles this; the UI shows a "Reconnecting…" state, no user action required.
6. **Subscription fanout.** A single session streaming screen updates at 60 fps can saturate the IPC channel. Mitigation: `ScreenStreamer` coalesces at 16 ms in the main process before forwarding to renderer; raw frames still available in the Wire Inspector if the user enables high-fidelity mode.

---

## 11. Non-Goals

- **Not a terminal replacement.** The app never executes a shell itself; it only talks to an already-running iTerm2.
- **Not a Python IDE.** Although it shows the `Scripts/` folder and can launch scripts through `launch API script named …`, it does not edit Python. Export stubs for authoring elsewhere.
- **Not cross-platform.** iTerm2 is macOS-only; the app is macOS-only. Electron is still a reasonable shell because it gives a first-class React/Tailwind story without macOS-native framework lock-in.
- **Not a package manager.** Does not install the iTerm2 Python runtime, does not bundle its own Python; see `it2-research` rationale for the Node-direct path.

---

## 12. Decision Record (in-line)

| Decision | Alternatives considered | Chosen | Reason |
|---|---|---|---|
| Bundle Python vs. speak protobuf directly | Python subprocess bridge; dual | **Direct protobuf from Node** | Two existing production references (`iterm2-typescript`, `MCPretentious`); avoids signed-Python shipping burden; single source of wire truth; better debugger UX |
| MobX vs. Zustand vs. Redux Toolkit | — | **MobX** | Required by user; also best fit for "many fine-grained observables mutated by a high-frequency event stream" |
| Client in main vs. renderer | — | **Main process** | Subscriptions outlive renderer windows; cookie stays off the renderer; `fs` / `child_process` live there anyway |
| Unix socket vs. TCP fallback | — | **Unix only** | Server removed TCP in 3.3.12; TCP path is dead code |
| One generic `Subscription<K>` vs. 12 `Monitor` classes (mirroring Python) | — | **Generic** | `LAW:one-type-per-behavior`; 12 classes differ only in payload, not behavior |

---

## 13. Glossary

- **OSC** — Operating System Command; escape sequence form `ESC ] … ST`. iTerm2's extensions live under OSC 1337 (proprietary) and OSC 133 (FinalTerm shell integration, also used by vt100).
- **RPC role** — the four categories iTerm2 recognizes for Python-registered callables: GENERIC, SESSION_TITLE, STATUS_BAR_COMPONENT, CONTEXT_MENU. Each gets different role-specific attributes.
- **Interpolated string** — an iTerm2 profile field value containing `\(expr)` placeholders resolved by `iTermExpressionEvaluator`.
- **Dynamic Profile** — a profile defined by a JSON file in `~/Library/Application Support/iTerm2/DynamicProfiles/`, watched and auto-imported.
- **Advisory name** — the human-readable name a client sends via `x-iterm2-advisory-name`; shown in iTerm2's Scripts console and announcement popups.
