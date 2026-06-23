// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeStore, THEMES, type ThemeId } from './ThemeStore';

const STORAGE_KEY = 'workspace-theme';

describe('ThemeStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('opens in the dark register by default', () => {
    const store = new ThemeStore();
    expect(store.theme).toBe('dark');
    expect(store.isActive('dark')).toBe(true);
    for (const theme of THEMES.filter((t) => t.id !== 'dark')) {
      expect(store.isActive(theme.id)).toBe(false);
    }
  });

  it('derives the document `dark` class from the theme value, immediately and on change', () => {
    const store = new ThemeStore();
    // The class matches the opening register without any user action — derived, not asserted by markup.
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    store.setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    store.toggle();
    expect(store.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('persists a chosen theme and restores it on reload', () => {
    const store = new ThemeStore();
    store.setTheme('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');

    const reloaded = new ThemeStore();
    expect(reloaded.theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('does not write the default register to storage until the user chooses one', () => {
    new ThemeStore();
    // Construction derives the class but records nothing — only an explicit choice persists.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('falls back to the default register on a corrupt or unknown payload, not a throw', () => {
    window.localStorage.setItem(STORAGE_KEY, 'sepia' as ThemeId);
    const store = new ThemeStore();
    expect(store.theme).toBe('dark');
  });
});
