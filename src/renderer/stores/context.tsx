import { createContext, useContext, type ReactNode } from 'react';
import type { RootStore } from './RootStore';

const StoreContext = createContext<RootStore | null>(null);

export function StoreProvider({
  value,
  children,
}: {
  value: RootStore;
  children: ReactNode;
}) {
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): RootStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore called outside <StoreProvider>');
  return store;
}
