// [LAW:one-source-of-truth] The canonical enumeration of workspace lenses and their switcher labels.
// A lens is a SUBJECT (observe + act + author fused), not a verb. The switcher maps over this list and
// the shell renders the active lens against it; neither hard-codes a second list that could drift.
//
// [LAW:one-way-deps] This lives in shared, not the renderer store, because a capability's deep-link
// target (DocLink's lens arm) names a LensId and is authored in shared/capabilities.ts. Putting the
// enumeration here lets the typed link reference a real LensId without shared importing the renderer.
export const LENSES = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'events', label: 'Events' },
  { id: 'fleet', label: 'Fleet' },
  { id: 'console', label: 'Console' },
  { id: 'template', label: 'Template' },
  { id: 'explore', label: 'Explore' },
  { id: 'build', label: 'Build' },
] as const;

export type LensId = (typeof LENSES)[number]['id'];
