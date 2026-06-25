import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  NotificationSchema,
  KeystrokeNotification_Action,
  Modifiers,
  FocusChangedNotification_Window_WindowStatus,
  VariableScope,
  GetBufferResponseSchema,
  CellStyleSchema,
  AlternateColor,
  PromptNotificationSchema,
  GetPromptResponseSchema,
  GetPromptResponse_State,
} from '@shared/proto/gen/api_pb';
import {
  classifyNotification,
  variableScopeName,
  convertGetBuffer,
  convertPromptNotification,
  convertGetPrompt,
} from './converters';
import { styledLinesToAnsi } from '@/domains/monitor/screenToAnsi';
import type { AppCellStyleRun } from '@shared/domain';

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

// [LAW:no-silent-failure] Protocol enums are open: iTerm2 can send an additive value this client's
// generated enum does not list. Drift must surface as 'unknown', never as a valid-but-wrong name.
describe('classifyNotification — tolerates additive enum drift', () => {
  it('maps an unrecognized keystroke action and modifier to unknown, not control/key-down', () => {
    const n = create(NotificationSchema, {
      keystrokeNotification: {
        session: 's1',
        characters: 'x',
        charactersIgnoringModifiers: 'x',
        modifiers: [999 as Modifiers],
        keyCode: 7,
        action: 998 as KeystrokeNotification_Action,
      },
    });

    expect(classifyNotification(n).payload).toEqual({
      characters: 'x',
      charactersIgnoringModifiers: 'x',
      modifiers: ['unknown'],
      keyCode: 7,
      action: 'unknown',
    });
  });
});

// [LAW:types-are-the-program] The CellStyle.fgColor/bgColor oneofs have four cases each; the converter
// must resolve every legal case, never silently drop one to null. These exercise the real public path
// (convertGetBuffer) so they assert the contract, not the private helpers [LAW:behavior-not-structure].
describe('cell-style color conversion — exhaustive over the oneof', () => {
  // Build a one-cell, one-line buffer carrying `style`, run it through the real conversion, return the run.
  function runFor(style: MessageInitShape<typeof CellStyleSchema>): AppCellStyleRun {
    const response = create(GetBufferResponseSchema, {
      contents: [{ text: 'x', style: [create(CellStyleSchema, { repeats: 1, ...style })] }],
    });
    return convertGetBuffer(response).lines[0].styles[0];
  }

  it('resolves fgStandard across the full xterm-256 palette, not just ANSI 0-15', () => {
    const cases: Array<[number, string]> = [
      [1, '#800000'],   // ANSI
      [9, '#ff0000'],   // bright ANSI
      [21, '#0000ff'],  // 6×6×6 cube
      [196, '#ff0000'], // cube
      [240, '#585858'], // grayscale ramp
    ];
    for (const [index, hex] of cases) {
      expect(runFor({ fgColor: { case: 'fgStandard', value: index } }).fg).toBe(hex);
    }
  });

  it('resolves bgStandard across the full xterm-256 palette', () => {
    expect(runFor({ bgColor: { case: 'bgStandard', value: 21 } }).bg).toBe('#0000ff');
    expect(runFor({ bgColor: { case: 'bgStandard', value: 240 } }).bg).toBe('#585858');
  });

  it('Alternate(DEFAULT) inherits the viewport default — null is intentional, and no reverse video', () => {
    const run = runFor({
      fgColor: { case: 'fgAlternate', value: AlternateColor.DEFAULT },
      bgColor: { case: 'bgAlternate', value: AlternateColor.DEFAULT },
    });
    expect(run.fg).toBeNull();
    expect(run.bg).toBeNull();
    expect(run.inverse).toBe(false);
  });

  it('Alternate(REVERSED_DEFAULT) folds into the inverse flag rather than dropping silently', () => {
    const run = runFor({
      fgColor: { case: 'fgAlternate', value: AlternateColor.REVERSED_DEFAULT },
      bgColor: { case: 'bgAlternate', value: AlternateColor.REVERSED_DEFAULT },
    });
    // fg/bg inherit the default; the reversal rides on `inverse` so it resolves against the viewport.
    expect(run.fg).toBeNull();
    expect(run.bg).toBeNull();
    expect(run.inverse).toBe(true);
  });

  it('Alternate(SYSTEM_MESSAGE) inherits the default without claiming reverse video', () => {
    const run = runFor({ fgColor: { case: 'fgAlternate', value: AlternateColor.SYSTEM_MESSAGE } });
    expect(run.fg).toBeNull();
    expect(run.inverse).toBe(false);
  });
});

// [LAW:verifiable-goals] The end-to-end claim the ticket cares about: a buffer of colored cells whose
// fg is real RGB (the parts iTerm2 colors) survives convertGetBuffer → styledLinesToAnsi as actual SGR,
// even when the surrounding default-colored cells are Alternate(DEFAULT). No monochrome wall.
describe('styled buffer round-trips to ANSI with color', () => {
  it('emits truecolor SGR for RGB runs sitting among Alternate(DEFAULT) runs', () => {
    const response = create(GetBufferResponseSchema, {
      contents: [
        {
          text: 'ok',
          style: [
            create(CellStyleSchema, {
              repeats: 2,
              fgColor: { case: 'fgRgb', value: { red: 0, green: 255, blue: 0 } },
            }),
          ],
        },
        {
          text: 'plain',
          style: [
            create(CellStyleSchema, {
              repeats: 5,
              fgColor: { case: 'fgAlternate', value: AlternateColor.DEFAULT },
            }),
          ],
        },
      ],
    });

    const ansi = styledLinesToAnsi(convertGetBuffer(response).lines);
    // green run carries an SGR; the default run does not.
    expect(ansi).toContain('\x1b[38;2;0;255;0mok\x1b[0m');
    expect(ansi).toContain('plain');
    expect(ansi).not.toContain('38;2;0;255;0mplain');
  });
});

describe('variableScopeName', () => {
  it('names each known scope', () => {
    expect(variableScopeName(VariableScope.SESSION)).toBe('session');
    expect(variableScopeName(VariableScope.TAB)).toBe('tab');
    expect(variableScopeName(VariableScope.WINDOW)).toBe('window');
    expect(variableScopeName(VariableScope.APP)).toBe('app');
  });

  it('maps an additive (unrecognized) scope to unknown rather than session', () => {
    expect(variableScopeName(999 as VariableScope)).toBe('unknown');
  });
});

describe('convertGetBuffer — baseLine carries the absolute window origin', () => {
  it('exposes the buffer window start as baseLine and relativizes the cursor against it', () => {
    const response = create(GetBufferResponseSchema, {
      windowedCoordRange: { coordRange: { start: { x: 0, y: 1000n }, end: { x: 0, y: 1050n } } },
      contents: [{ text: 'hi', style: [] }],
      cursor: { x: 3, y: 1004n },
    });
    const { baseLine, cursor } = convertGetBuffer(response);
    expect(baseLine).toBe(1000);
    // cursor.y is absolute 1004 minus the 1000-line base => buffer row 4.
    expect(cursor).toEqual({ x: 3, y: 4 });
  });

  it('defaults baseLine to 0 when no windowed range is reported', () => {
    const response = create(GetBufferResponseSchema, { contents: [{ text: '', style: [] }] });
    expect(convertGetBuffer(response).baseLine).toBe(0);
  });
});

describe('convertPromptNotification — typed prompt updates', () => {
  it('converts a prompt event with absolute regions and working directory', () => {
    const p = create(PromptNotificationSchema, {
      session: 's1',
      uniquePromptId: 'p-1',
      event: {
        case: 'prompt',
        value: {
          prompt: {
            promptRange: { start: { x: 0, y: 1005n }, end: { x: 2, y: 1005n } },
            commandRange: { start: { x: 2, y: 1005n }, end: { x: 8, y: 1005n } },
            workingDirectory: '/home/me',
            command: 'ls',
          },
        },
      },
    });
    expect(convertPromptNotification(p)).toEqual({
      sessionId: 's1',
      update: {
        kind: 'prompt',
        uniquePromptId: 'p-1',
        promptRange: { start: { x: 0, line: 1005 }, end: { x: 2, line: 1005 } },
        commandRange: { start: { x: 2, line: 1005 }, end: { x: 8, line: 1005 } },
        outputRange: null,
        workingDirectory: '/home/me',
        command: 'ls',
      },
    });
  });

  it('converts command-start into a typed command update', () => {
    const p = create(PromptNotificationSchema, {
      session: 's1',
      uniquePromptId: 'p-1',
      event: { case: 'commandStart', value: { command: 'false' } },
    });
    expect(convertPromptNotification(p)).toEqual({
      sessionId: 's1',
      update: { kind: 'command-start', uniquePromptId: 'p-1', command: 'false' },
    });
  });

  it('converts command-end into the exit code update', () => {
    const p = create(PromptNotificationSchema, {
      session: 's1',
      uniquePromptId: 'p-1',
      event: { case: 'commandEnd', value: { status: 1 } },
    });
    expect(convertPromptNotification(p)).toEqual({
      sessionId: 's1',
      update: { kind: 'command-end', uniquePromptId: 'p-1', exitStatus: 1 },
    });
  });

  it('drops a notification with no session rather than placing it on a guessed session', () => {
    const p = create(PromptNotificationSchema, {
      uniquePromptId: 'p-1',
      event: { case: 'commandEnd', value: { status: 0 } },
    });
    expect(convertPromptNotification(p)).toBeNull();
  });

  it('treats a half-present region as no region (null), never a guessed coordinate', () => {
    const p = create(PromptNotificationSchema, {
      session: 's1',
      uniquePromptId: 'p-1',
      event: { case: 'prompt', value: { prompt: { promptRange: { start: { x: 0, y: 5n } } } } },
    });
    const result = convertPromptNotification(p);
    expect(result?.update.kind).toBe('prompt');
    expect(result?.update).toMatchObject({ promptRange: null });
  });
});

describe('convertGetPrompt — poll-on-demand prompt to canonical AppPrompt', () => {
  it('maps FINISHED to the finished variant carrying the exit code', () => {
    const r = create(GetPromptResponseSchema, {
      uniquePromptId: 'p-9',
      promptState: GetPromptResponse_State.FINISHED,
      exitStatus: 37,
      command: 'exit 37',
      workingDirectory: '/code',
    });
    expect(convertGetPrompt(r)).toEqual({
      uniquePromptId: 'p-9',
      promptRange: null,
      commandRange: null,
      outputRange: null,
      workingDirectory: '/code',
      command: 'exit 37',
      state: 'finished',
      exitStatus: 37,
    });
  });

  it('maps RUNNING to the running variant with no exit code field', () => {
    const r = create(GetPromptResponseSchema, {
      uniquePromptId: 'p-9',
      promptState: GetPromptResponse_State.RUNNING,
      command: 'sleep 10',
    });
    const prompt = convertGetPrompt(r);
    expect(prompt.state).toBe('running');
    expect('exitStatus' in prompt).toBe(false);
  });

  it('maps EDITING to the editing variant', () => {
    const r = create(GetPromptResponseSchema, {
      uniquePromptId: 'p-9',
      promptState: GetPromptResponse_State.EDITING,
    });
    expect(convertGetPrompt(r).state).toBe('editing');
  });
});
