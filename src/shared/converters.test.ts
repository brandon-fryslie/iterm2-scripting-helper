import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  NotificationSchema,
  KeystrokeNotification_Action,
  Modifiers,
  FocusChangedNotification_Window_WindowStatus,
} from '@shared/proto/gen/api_pb';
import { classifyNotification } from './converters';

// [LAW:verifiable-goals] 449.7.10 STEP 1: the spine notification payload must be information-complete —
// it carries the same keystroke/prompt/focus detail the now-deleted side-stores held, so no detail is
// lost in the timeline's Detail inspector (which renders payload verbatim). These assert the fields
// that used to live ONLY in the side-stores now ride on the notification's payload.

describe('classifyNotification — information-complete payloads', () => {
  it('keystroke payload carries modifiers and charactersIgnoringModifiers as canonical strings', () => {
    const n = create(NotificationSchema, {
      keystrokeNotification: {
        session: 's1',
        characters: 'a',
        charactersIgnoringModifiers: 'A',
        modifiers: [Modifiers.CONTROL, Modifiers.SHIFT],
        keyCode: 65,
        action: KeystrokeNotification_Action.KEY_DOWN,
      },
    });

    const c = classifyNotification(n);
    expect(c.kind).toBe('keystroke');
    expect(c.sessionId).toBe('s1');
    expect(c.payload).toEqual({
      characters: 'a',
      charactersIgnoringModifiers: 'A',
      modifiers: ['control', 'shift'],
      keyCode: 65,
      action: 'key-down',
    });
  });

  it('prompt command-start payload carries the command', () => {
    const n = create(NotificationSchema, {
      promptNotification: {
        session: 's1',
        uniquePromptId: 'p-1',
        event: { case: 'commandStart', value: { command: 'ls -la' } },
      },
    });

    const c = classifyNotification(n);
    expect(c.kind).toBe('prompt');
    expect(c.payload).toEqual({
      event: 'commandStart',
      uniquePromptId: 'p-1',
      kind: 'command-start',
      command: 'ls -la',
    });
  });

  it('prompt command-end payload carries the exit status', () => {
    const n = create(NotificationSchema, {
      promptNotification: {
        session: 's1',
        uniquePromptId: 'p-2',
        event: { case: 'commandEnd', value: { status: 127 } },
      },
    });

    expect(classifyNotification(n).payload).toEqual({
      event: 'commandEnd',
      uniquePromptId: 'p-2',
      kind: 'command-end',
      status: 127,
    });
  });

  it('prompt payload carries placeholder and working directory', () => {
    const n = create(NotificationSchema, {
      promptNotification: {
        session: 's1',
        uniquePromptId: 'p-3',
        event: {
          case: 'prompt',
          value: { placeholder: 'type here', prompt: { workingDirectory: '/home/me' } },
        },
      },
    });

    expect(classifyNotification(n).payload).toEqual({
      event: 'prompt',
      uniquePromptId: 'p-3',
      kind: 'prompt',
      placeholder: 'type here',
      workingDirectory: '/home/me',
    });
  });

  it('focus window payload carries windowId and canonical windowStatus', () => {
    const n = create(NotificationSchema, {
      focusChangedNotification: {
        event: {
          case: 'window',
          value: {
            windowId: 'w-1',
            windowStatus:
              FocusChangedNotification_Window_WindowStatus.TERMINAL_WINDOW_BECAME_KEY,
          },
        },
      },
    });

    const c = classifyNotification(n);
    expect(c.kind).toBe('focus-changed');
    expect(c.payload).toEqual({
      event: 'window',
      kind: 'window',
      windowId: 'w-1',
      windowStatus: 'became-key',
    });
  });

  it('focus session payload carries the session id', () => {
    const n = create(NotificationSchema, {
      focusChangedNotification: {
        event: { case: 'session', value: 's9' },
      },
    });

    expect(classifyNotification(n).payload).toEqual({
      event: 'session',
      kind: 'session',
      sessionId: 's9',
    });
  });
});
