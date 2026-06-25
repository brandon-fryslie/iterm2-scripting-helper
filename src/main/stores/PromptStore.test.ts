import { describe, it, expect } from 'vitest';
import type { AppPromptRange } from '@shared/domain';
import { PromptStore } from './PromptStore';

const SESSION = 'w0t0p0';
const range = (line: number): AppPromptRange => ({ start: { x: 0, line }, end: { x: 0, line } });

describe('PromptStore — correlates the three OSC-133 events by uniquePromptId', () => {
  it('accumulates prompt → command-start → command-end into one finished prompt with the exit code', () => {
    const store = new PromptStore();
    store.setFocused(SESSION);

    store.applyUpdate(SESSION, {
      kind: 'prompt',
      uniquePromptId: 'a',
      promptRange: range(10),
      commandRange: null,
      outputRange: null,
      workingDirectory: '/tmp',
      command: null,
    });
    store.applyUpdate(SESSION, { kind: 'command-start', uniquePromptId: 'a', command: 'false' });
    store.applyUpdate(SESSION, { kind: 'command-end', uniquePromptId: 'a', exitStatus: 1 });

    expect(store.snapshot().prompts).toEqual([
      {
        uniquePromptId: 'a',
        promptRange: range(10),
        commandRange: null,
        outputRange: null,
        workingDirectory: '/tmp',
        command: 'false',
        state: 'finished',
        exitStatus: 1,
      },
    ]);
  });

  it('carries the region forward even though command-end delivers no ranges', () => {
    const store = new PromptStore();
    store.setFocused(SESSION);
    store.applyUpdate(SESSION, {
      kind: 'prompt',
      uniquePromptId: 'a',
      promptRange: range(3),
      commandRange: range(3),
      outputRange: null,
      workingDirectory: null,
      command: null,
    });
    store.applyUpdate(SESSION, { kind: 'command-end', uniquePromptId: 'a', exitStatus: 0 });

    const [p] = store.snapshot().prompts;
    expect(p.promptRange).toEqual(range(3));
    expect(p.commandRange).toEqual(range(3));
    expect(p.state).toBe('finished');
  });

  it('preserves prompt-draw order across multiple prompts', () => {
    const store = new PromptStore();
    store.setFocused(SESSION);
    for (const id of ['a', 'b', 'c']) {
      store.applyUpdate(SESSION, {
        kind: 'prompt',
        uniquePromptId: id,
        promptRange: range(0),
        commandRange: null,
        outputRange: null,
        workingDirectory: null,
        command: null,
      });
    }
    // A late command-end on the first prompt must not reorder it.
    store.applyUpdate(SESSION, { kind: 'command-end', uniquePromptId: 'a', exitStatus: 2 });
    expect(store.snapshot().prompts.map((p) => p.uniquePromptId)).toEqual(['a', 'b', 'c']);
  });

  it('drops updates for a non-focused session at the store boundary', () => {
    const store = new PromptStore();
    store.setFocused(SESSION);
    store.applyUpdate('other', {
      kind: 'prompt',
      uniquePromptId: 'x',
      promptRange: range(1),
      commandRange: null,
      outputRange: null,
      workingDirectory: null,
      command: null,
    });
    expect(store.snapshot().prompts).toEqual([]);
  });

  it('clears prompts when focus moves to another session', () => {
    const store = new PromptStore();
    store.setFocused(SESSION);
    store.applyUpdate(SESSION, {
      kind: 'prompt',
      uniquePromptId: 'a',
      promptRange: range(1),
      commandRange: null,
      outputRange: null,
      workingDirectory: null,
      command: null,
    });
    store.setFocused('next');
    expect(store.snapshot()).toEqual({ sessionId: 'next', prompts: [] });
  });
});
