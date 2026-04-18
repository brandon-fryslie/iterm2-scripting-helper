# iTerm2 Scripting Workbench

An Electron desktop app that provides complete observability and tooling for every iTerm2 scripting surface. See [PROJECT.md](./PROJECT.md) for the proposal.

## Prerequisites

- macOS (iTerm2 is macOS-only)
- Node 22+
- pnpm

## Develop

```sh
pnpm install
pnpm start
```

## Test

```sh
pnpm test           # typecheck + vitest + build + playwright e2e
pnpm test:unit      # vitest only
pnpm test:e2e       # playwright only (requires a fresh `pnpm build`)
pnpm typecheck      # tsc --noEmit
```
