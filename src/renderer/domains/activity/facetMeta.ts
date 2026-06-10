import type { ActivityFacet } from '@shared/activity';

// Presentation metadata for the timeline's facets — the display label and badge styling for each
// lane. Kept beside the components (this is view concern, not domain): the domain owns the facet set.
export const FACET_LABEL: Record<ActivityFacet, string> = {
  frame: 'Frames',
  notification: 'Notifications',
  keystroke: 'Keystrokes',
  prompt: 'Prompts',
  focus: 'Focus',
  'variable-change': 'Variables',
  action: 'Actions',
  invocation: 'Invocations',
};

// Wall-clock formatting shared by every row + the detail header, matching the panes this view
// replaces (HH:MM:SS.mmm).
export function formatTime(at: number): string {
  return new Date(at).toISOString().slice(11, 23);
}
