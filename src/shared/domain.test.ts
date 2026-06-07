import { describe, expect, it } from 'vitest';
import {
  APP_ENTITY,
  appEntityExistsInLayout,
  appEntityKey,
  flatSessions,
  isSessionEntity,
  sessionEntityRef,
  tabEntityRef,
  windowEntityRef,
  type AppTab,
  type AppWindow,
} from './domain';

const tab: AppTab = {
  tabId: 'tab-1',
  tmuxWindowId: '',
  tmuxConnectionId: '',
  minimizedSessions: [],
  root: {
    vertical: false,
    children: [
      {
        kind: 'session',
        session: {
          sessionId: 'session-1',
          title: 'shell',
          frame: null,
          gridSize: null,
        },
      },
    ],
  },
};

const window: AppWindow = {
  windowId: 'window-1',
  tabs: [tab],
  frame: null,
  number: 1,
};

describe('entity focus refs', () => {
  it('carry parent identity through the entity graph', () => {
    const session = flatSessions(tab)[0];
    const ref = sessionEntityRef(window, tab, session);

    expect(ref).toEqual({
      kind: 'session',
      windowId: 'window-1',
      tabId: 'tab-1',
      sessionId: 'session-1',
    });
    expect(isSessionEntity(ref)).toBe(true);
  });

  it('derive stable keys by entity kind', () => {
    expect(appEntityKey(windowEntityRef(window))).toBe('window:window-1');
    expect(appEntityKey(tabEntityRef(window, tab))).toBe('tab:window-1:tab-1');
    expect(appEntityKey(sessionEntityRef(window, tab, flatSessions(tab)[0]))).toBe(
      'session:window-1:tab-1:session-1',
    );
  });

  it('validates entity refs against the layout graph', () => {
    expect(appEntityExistsInLayout({ windows: [window] }, APP_ENTITY)).toBe(true);
    expect(appEntityExistsInLayout({ windows: [window] }, windowEntityRef(window))).toBe(
      true,
    );
    expect(appEntityExistsInLayout({ windows: [window] }, tabEntityRef(window, tab))).toBe(
      true,
    );
    expect(
      appEntityExistsInLayout(
        { windows: [window] },
        sessionEntityRef(window, tab, flatSessions(tab)[0]),
      ),
    ).toBe(true);
    expect(
      appEntityExistsInLayout({ windows: [window] }, {
        kind: 'session',
        windowId: 'window-1',
        tabId: 'tab-1',
        sessionId: 'gone',
      }),
    ).toBe(false);
  });
});
