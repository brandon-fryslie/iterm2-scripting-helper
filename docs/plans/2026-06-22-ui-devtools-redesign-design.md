# iTerm2 Workbench UI — "DevTools for iTerm2" redesign

## Why

The app exposes ~74 distinct capabilities over iTerm2's API, but the UI cuts them
along **verbs** — Observe (Screen/Variables/Activity), Act (the action forms),
Author (nine editors) — and co-presents all six facets at once on launch.

Two consequences, both architectural, not cosmetic:

- **The cut fragments every subject.** A broadcast domain is inspected and edited
  in Author but applied via Act; an arrangement is inspected/diffed in Author but
  saved/restored via Act; an escape sequence is authored in Author but emitted as
  an Act/inject. The same subject straddles three panels. This is a
  `[LAW:decomposition]` failure: boundaries don't fall where the domain separates.
- **"Everything open" is the only representable default.** `WorkspaceLayoutStore`
  models facets as a flat `FACETS` list with a `hidden` set defaulting to empty,
  so the canonical state is "all six visible, ungrouped." The incoherence is baked
  into the type — a `[LAW:types-are-the-program]` failure.

## What this tool is for (the decided thesis)

**Make iTerm2's opaque internal state and vast API legible and experimentable for
people writing advanced automation — "DevTools for iTerm2."** iTerm2's live state
(variables across scopes, screen, layout, the event/notification stream, RPC
invocations) and its API surface (actions, functions, registrations, escape
sequences, sdef, profiles) are normally reachable only by writing Python scripts
blind. The browser-DevTools move — turn opacity into something you can see, probe,
and poke — is the unique value. Constructing a title/badge/status-bar template from
*live* values instead of guessing variable names is one instance of the general
value, not the whole product.

## The architecture: entity spine × one focal lens

Two orthogonal axes.

### Axis 1 — the entity spine (always present)

`EntityFocusStore` already focuses exactly one `AppEntityRef` of kind
`app → window → tab → session`, swapped whole (`[LAW:one-source-of-truth]`). The
left rail is this spine: the layout tree + connection/focus status. It selects
*whose* state every lens inspects/acts on/authors against. It is **not** a lens and
is never hidden — it is the navigation axis.

### Axis 2 — lenses (one focal at a time)

A lens is a **subject**, with observe + act + author fused for that subject. Exactly
one lens is active. This is the type that makes "everything open" unrepresentable:
`activeLens: LensId`, a single value, replaces the flat facet set + hidden bitmask.

| Lens | Subject | Composes (existing panes) |
|------|---------|---------------------------|
| **Inspect** (default) | the focused entity's live internal state | `VariablesPane` (+ expression probe) and `ScreenPane` |
| **Events** | what iTerm2 emits over time + provenance | `ActivityTimeline`, `EventDetail`, `FixtureControls` |
| **Console** | experiment: fire actions/functions/escapes | `ActPane` (action forms + snippets + focus target) |
| **Build** | durable artifacts & static config | `AuthorPane` (registrations, dynamic profiles, triggers, arrangements, broadcast, key bindings, profiles) |

Settings (connection/auth/capabilities/docs/errors) stays a utility overlay reached
from the rail gear — not a lens.

### Why this is coherent (law trace)

- `[LAW:decomposition]` — cut by subject; each subject is whole, reachable in one
  place. No subject straddles a seam.
- `[LAW:types-are-the-program]` — `activeLens: LensId` (one value) replaces
  `hidden: Set<FacetId>`. The illegal "all-flat-open" state is gone by construction;
  the calm default (`'inspect'`) is the only thing a fresh profile can be.
- `[LAW:dataflow-not-control-flow]` — the lens switcher maps over a canonical
  `LENSES` list; the shell renders `LENSES[active].render()`. No per-lens branches
  in the chrome.
- `[LAW:one-source-of-truth]` — the entity spine remains the single focus authority;
  lenses are pure views over it.

## Build order (epic)

1. **Lens shell foundation** *(this slice)* — introduce the `LensId` model
   (replacing the flat facet/hidden model), a lens switcher, and recompose
   `EntityWorkspace` to render the always-present entity rail + one active lens.
   Re-home existing panes into lenses. Default `inspect`. The structural fix for
   "everything open / incoherent." Panes reused as-is.
2. **Inspect lens as the hero** — elevate live-variable browsing + expression probe;
   make variables the focal material, screen the companion.
3. **Persistent live context** — keep a slim live strip (focus + screen cursor +
   connection) visible across lenses so the experiment→observe loop survives lens
   switches.
4. **Console ↔ Events coupling** — when firing in Console, surface the resulting
   spine event inline so cause/effect is one glance.
5. **Subject consolidation** — pull arrangement/broadcast/escape "act" verbs out of
   the Console action grid into their Build subjects, so each subject is truly whole.
6. **Visual language pass** — design tokens, type scale, spacing rhythm, real
   light/dark (the broken light mode), hierarchy. Done last: tokens propagate, so
   they land cleanly only once the structure is settled.

## Non-goals (YAGNI)

- Not rewriting the nine Build editors or the action forms — they are self-contained
  and reused verbatim.
- Not adding new iTerm2 capabilities in this epic — re-cutting existing ones.
