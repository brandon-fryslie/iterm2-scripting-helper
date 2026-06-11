import { describe, it, expect } from 'vitest';
import {
  addDomain,
  applyableDomains,
  assignedSessionIds,
  crossWindowDomainIndices,
  domainsEqual,
  moveSession,
  parseDomainsText,
  removeDomain,
  sessionsByWindow,
  staleSessionIds,
} from './broadcastDomains';
import type { AppSession, AppWindow } from './domain';

function session(id: string, title = id): AppSession {
  return { sessionId: id, title, frame: null, gridSize: null };
}

function windowOf(windowId: string, number: number, sessionIds: string[]): AppWindow {
  return {
    windowId,
    number,
    frame: null,
    tabs: [
      {
        tabId: `${windowId}-t1`,
        tmuxWindowId: '',
        tmuxConnectionId: '',
        minimizedSessions: [],
        root: {
          vertical: false,
          children: sessionIds.map((id) => ({ kind: 'session' as const, session: session(id) })),
        },
      },
    ],
  };
}

const WINDOWS = [windowOf('w1', 1, ['s1', 's2', 's3']), windowOf('w2', 2, ['s4'])];

describe('broadcast draft ops', () => {
  it('moveSession removes the session from every domain before inserting — disjointness by construction', () => {
    const draft = [['s1', 's2'], ['s3']];
    expect(moveSession(draft, 's1', 1)).toEqual([['s2'], ['s3', 's1']]);
  });

  it('moveSession with a null target removes the session from all domains', () => {
    expect(moveSession([['s1', 's2']], 's1', null)).toEqual([['s2']]);
  });

  it('moveSession into the domain a session already occupies keeps exactly one membership', () => {
    expect(moveSession([['s1', 's2']], 's1', 0)).toEqual([['s2', 's1']]);
  });

  it('add/remove domain are positional value updates', () => {
    expect(addDomain([['s1']])).toEqual([['s1'], []]);
    expect(removeDomain([['s1'], ['s2']], 0)).toEqual([['s2']]);
  });

  it('applyableDomains strips empty scaffolding domains', () => {
    expect(applyableDomains([[], ['s1'], []])).toEqual([['s1']]);
  });

  it('assignedSessionIds flattens membership', () => {
    expect(assignedSessionIds([['s1'], ['s2', 's3']])).toEqual(new Set(['s1', 's2', 's3']));
  });
});

describe('domainsEqual', () => {
  it('ignores domain order, member order, and empty scaffolding', () => {
    expect(domainsEqual([['s2', 's1'], []], [['s1', 's2']])).toBe(true);
    expect(domainsEqual([['s1'], ['s2']], [['s2'], ['s1']])).toBe(true);
  });

  it('membership differences are real differences', () => {
    expect(domainsEqual([['s1', 's2']], [['s1']])).toBe(false);
    expect(domainsEqual([['s1', 's2']], [['s1'], ['s2']])).toBe(false);
  });
});

describe('layout-derived predictions', () => {
  it('sessionsByWindow flattens split trees per window', () => {
    const pool = sessionsByWindow(WINDOWS);
    expect(pool.map((w) => w.sessions.map((s) => s.sessionId))).toEqual([
      ['s1', 's2', 's3'],
      ['s4'],
    ]);
  });

  it('flags only domains whose members span more than one window', () => {
    expect(crossWindowDomainIndices([['s1', 's2'], ['s3', 's4']], WINDOWS)).toEqual([1]);
  });

  it('a session missing from the layout is stale, not cross-window', () => {
    const draft = [['s1', 'ghost']];
    expect(crossWindowDomainIndices(draft, WINDOWS)).toEqual([]);
    expect(staleSessionIds(draft, WINDOWS)).toEqual(['ghost']);
  });
});

describe('parseDomainsText', () => {
  it('parses one domain per line with comma or whitespace separators', () => {
    expect(parseDomainsText('s1, s2\n\ns3 s4,s5\n')).toEqual([
      ['s1', 's2'],
      ['s3', 's4', 's5'],
    ]);
  });

  it('empty text is the empty table (clears all broadcasting)', () => {
    expect(parseDomainsText('')).toEqual([]);
    expect(parseDomainsText('  \n ')).toEqual([]);
  });
});
