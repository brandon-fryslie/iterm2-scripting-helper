import { describe, expect, it } from 'vitest';
import { resolveUpdaterConfig } from './updaterConfig';

describe('resolveUpdaterConfig', () => {
  it('enables autoupdate against the baked URL in a packaged build', () => {
    expect(
      resolveUpdaterConfig({ isPackaged: true, feedUrl: 'https://updates.example.com/workbench/' }),
    ).toEqual({ kind: 'enabled', feedUrl: 'https://updates.example.com/workbench/' });
  });

  it('disables autoupdate in a dev (unpackaged) run regardless of URL', () => {
    const decision = resolveUpdaterConfig({ isPackaged: false, feedUrl: 'https://updates.example.com/' });
    expect(decision.kind).toBe('disabled');
  });

  it('disables autoupdate when no feed URL was baked in', () => {
    const decision = resolveUpdaterConfig({ isPackaged: true, feedUrl: '' });
    expect(decision.kind).toBe('disabled');
  });

  it('treats a whitespace-only URL as unset and trims a real one', () => {
    expect(resolveUpdaterConfig({ isPackaged: true, feedUrl: '   ' }).kind).toBe('disabled');
    expect(resolveUpdaterConfig({ isPackaged: true, feedUrl: '  https://u/  ' })).toEqual({
      kind: 'enabled',
      feedUrl: 'https://u/',
    });
  });
});
