import { useDefaultLayout } from 'react-resizable-panels';

// [LAW:one-source-of-truth] The single mechanism + keying policy for persisting workspace region
// sizes. Every resizable Group in the shell routes its layout through here — storage backend and key
// scheme are defined once, never re-decided per group. Returns the props to spread onto a Group.
export function usePersistedLayout(id: string) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id,
    storage: window.localStorage,
  });
  return { defaultLayout, onLayoutChanged } as const;
}
