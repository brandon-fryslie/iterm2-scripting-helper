# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An Electron desktop app (iTerm2 Scripting Workbench) that provides observability, authoring, and interactive tooling for every iTerm2 scripting surface — Python API, AppleScript/JXA, Dynamic Profiles, OSC escape sequences, shell integration, and the raw protobuf protocol. See PROJECT.md for the full design doc.

## Commands

```bash
pnpm start              # Dev server with hot reload (Electron Forge + Vite)
pnpm build              # Package the app
pnpm lint               # ESLint
pnpm typecheck          # tsc --noEmit
pnpm test:unit          # Vitest unit tests
pnpm test:e2e           # Playwright E2E (requires fresh pnpm build first)
pnpm test               # Full CI: typecheck → vitest → build → playwright
pnpm gen:proto          # Regenerate protobuf from proto/api.proto via buf
```

Requirements: macOS, Node 22+, pnpm.

## Architecture

### Process Model

```
iTerm2 (Unix socket) → ProtocolDriver → ConnectionOrchestrator
                                              ↓
                                        MobX Stores (main process)
                                              ↓
                                        IPC Bridge (typed RPC)
                                              ↓
                                  MobX Stores (renderer mirrors, read-only)
                                              ↓
                                        React Components
```

**Main process** owns all drivers, stores, and the iTerm2 connection. The cookie (auth secret) never crosses into the renderer. Subscriptions outlive renderer-window lifecycle.

**Renderer** is a read-only projection. All writes go through IPC (`ipc.invoke('rpc', { method, args })`). Events flow main → renderer via `window.ipc.on(kind, handler)`.

### Source Layout

- `src/main/drivers/` — ProtocolDriver (WebSocket + protobuf codec, the only module that speaks protobuf), AppleScriptDriver (osascript for cookie auth), ConnectionOrchestrator (handshake lifecycle, routes notifications to stores), DynamicProfileWatcher (chokidar)
- `src/main/stores/` — One MobX store per domain (Connection, Layout, Variable, WireLog, NotificationHub, KeystrokeLog, PromptLog, FocusLog, ScreenStream, DynamicProfile, Registration, CustomEscape). Each is the single source of truth for its domain.
- `src/main/ipc.ts` — 47 typed RPC handlers. The IPC schema lives in `src/shared/rpc.ts` (`RpcSchema` type + `EventSchema` type).
- `src/main/actions.ts` — Console action implementations (send text, inject bytes, activate, invoke function, etc.)
- `src/main/workbench.ts` — Workbench features (profile editing, registration, dynamic profiles)
- `src/shared/rpc.ts` — Shared types for all IPC. `RpcSchema` maps method names to args/result. `EventSchema` maps event kinds to payloads.
- `src/shared/escape-sequences.ts` — OSC/CSI template definitions
- `src/shared/proto/` — Generated protobuf code from `proto/api.proto`
- `src/renderer/tabs/` — Four tabs: Monitor (9 dockable panes), Workbench (authoring surface), Console (interactive driver), Settings
- `src/renderer/stores/` — Renderer-side MobX mirrors that subscribe to main-process events
- `src/preload/preload.ts` — Context bridge exposing typed IPC to renderer

### iTerm2 Connection

Transport: Unix domain socket at `~/Library/Application Support/iTerm2/private/socket` via `ws+unix://`. The `ws` library URL-encodes spaces, so ProtocolDriver creates a temp symlink in `/tmp/` pointing to the real socket.

Protocol: One binary WebSocket frame = one protobuf `ClientOriginatedMessage` or `ServerOriginatedMessage`. Request/response correlated via `id: int64`. Notifications arrive with no `id` on tag 1000.

Auth flow: AppleScriptDriver runs `osascript` to request a cookie/key pair from iTerm2, then ProtocolDriver sends those as WebSocket headers.

### State Management

Main-process stores are MobX observables. `mobx.autorun` broadcasts snapshots to the renderer on mutation. Renderer stores subscribe to these snapshots and expose them to React components via `mobx-react-lite`.

Ring buffers (default capacity 2000) prevent unbounded memory in high-frequency stores (WireLog, KeystrokeLog, NotificationHub, etc.).

Screen streaming uses 16ms coalescing to avoid IPC channel saturation.

### Protobuf

`proto/api.proto` (1600+ lines) defines the full iTerm2 API — 34 request types, 13 notification types. `pnpm gen:proto` uses `buf` to generate typed code into `src/shared/proto/gen/`. Never edit generated files directly; edit the `.proto` and regenerate.

## Key Patterns

- **Generic Subscription**: All notification subscriptions use one `Subscription<K extends NotificationKind>` type parameterized by enum, not separate classes per notification type.
- **Single Enforcer**: Only ProtocolDriver speaks protobuf/WebSocket. All other modules receive decoded events from stores.
- **Cross-pane focus**: Selecting an entity in one Monitor pane propagates as the focus for all other panes (via `focusedSessionId`).

## Build Config

Electron Forge with Vite plugin. Three Vite configs: `vite.main.config.mts`, `vite.preload.config.mts`, `vite.renderer.config.mts`. Tailwind 4 via `@tailwindcss/vite`. TypeScript path aliases: `@/*` → `src/renderer/*`, `@shared/*` → `src/shared/*`.
