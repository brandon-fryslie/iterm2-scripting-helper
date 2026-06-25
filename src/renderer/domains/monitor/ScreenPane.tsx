import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { autorun } from 'mobx';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { PanelRight } from 'lucide-react';
import { useStore } from '@/stores/context';
import { styledLinesToAnsi, cursorToViewport } from './screenToAnsi';
import { screenContextForFocus } from './screenContext';
import { PromptStructureRail } from './PromptStructureRail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// [LAW:dataflow-not-control-flow] The three render states are a switch over the shared screen-context
// descriptor's discriminant, not ad-hoc `if (!focused)`/`if (mismatch)` guards re-derived here — the
// same classifier feeds the live context strip, so the viewport and the strip can never disagree about
// whether a session's screen is live. [LAW:one-source-of-truth]
export const ScreenPane = observer(function ScreenPane() {
  const { entityFocus, monitor } = useStore();
  const ctx = screenContextForFocus(entityFocus.sessionId, monitor.screen);

  switch (ctx.status) {
    case 'none':
      return (
        <div
          className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
          data-testid="screen-pane"
          data-empty="true"
        >
          Select a session in Layout to render its screen.
        </div>
      );
    case 'pending':
      return (
        <div
          className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
          data-testid="screen-pane"
          data-empty="loading"
        >
          Rendering {ctx.sessionId.slice(0, 12)}…
        </div>
      );
    case 'live':
      return (
        <div className="flex h-full flex-col" data-testid="screen-pane">
          <div className="flex items-center gap-2 border-b px-3 py-1 text-xs">
            <code className="text-muted-foreground">{ctx.sessionId.slice(0, 12)}…</code>
            <Badge variant="secondary">{ctx.lineCount} lines</Badge>
            {ctx.cursor && (
              <Badge variant="outline">
                cursor ({ctx.cursor.x}, {ctx.cursor.y})
              </Badge>
            )}
            <Badge variant="outline">updates: {monitor.screen.updatesReceived}</Badge>
            <Button
              variant={monitor.screenOverlayEnabled ? 'secondary' : 'ghost'}
              size="sm"
              className="ml-auto h-6 gap-1 px-2 text-xs"
              aria-pressed={monitor.screenOverlayEnabled}
              data-testid="screen-overlay-toggle"
              onClick={() => monitor.toggleScreenOverlay()}
            >
              <PanelRight className="size-3" />
              Structure
            </Button>
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              <XTermScreen />
            </div>
            <PromptStructureRail />
          </div>
        </div>
      );
  }
});

const FONT_SIZE = 13;

// [LAW:one-source-of-truth] The terminal font stack lives once, in the `--font-terminal` token
// (globals.css). Read it here rather than re-typing the family literal, so the viewport and the stylesheet
// can never name different fonts. [LAW:no-silent-failure] An empty token means the renderer stylesheet
// failed to load; xterm would otherwise fall back to a default monospace and tofu every powerline/devicon
// glyph — fail loudly instead of rendering the wrong font in silence.
function readTerminalFontStack(): string {
  const stack = getComputedStyle(document.documentElement).getPropertyValue('--font-terminal').trim();
  if (!stack) {
    throw new Error('--font-terminal is undefined; renderer stylesheet did not load before the Screen viewport');
  }
  return stack;
}

// The first family in the stack is the bundled face we must wait on before xterm measures cells; the
// rest are always-available system fallbacks. Strip the quotes so document.fonts.load gets a bare name.
function primaryFamily(stack: string): string {
  return stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}

const XTermScreen = observer(function XTermScreen() {
  const { entityFocus, monitor } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fontStack = readTerminalFontStack();

    const term = new Terminal({
      fontSize: FONT_SIZE,
      fontFamily: fontStack,
      convertEol: true,
      scrollback: 1000,
      cursorBlink: true,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
      },
      // [LAW:effects-at-boundaries] OSC-8 hyperlinks (emitted by screenToAnsi from each cell's `url`)
      // are made activatable here, at the viewport boundary. WebLinksAddon below only auto-detects
      // plaintext URLs; this handles true OSC-8 links where the visible text differs from the target.
      // allowNonHttpProtocols stays at its safe default (false) so only http(s) targets open — a
      // file://-scheme link from a session never triggers an external open.
      linkHandler: {
        activate: (_event, uri) => {
          window.open(uri, '_blank', 'noopener,noreferrer');
        },
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    let lastSessionId: string | null = null;
    let lastUpdatesReceived = -1;

    // Render the screen snapshot into the viewport and place the cursor. Full (session change)
    // and incremental (same-session update) are one behavior parameterized by `reset`: full clears
    // the previous session's scrollback and loads all fetched lines as history; incremental repaints
    // only the visible window in place so scrollback isn't re-grown on every update.
    const render = (reset: boolean) => {
      const snap = monitor.screen;
      if (snap.lines.length === 0 || term.rows === 0) return;

      // [FRAMING:representation] cursor.y is a buffer index, but ANSI `\x1b[row;colH` addresses the
      // viewport — different coordinate spaces. The viewport shows the last `term.rows` lines, so the
      // cursor's screen row is its buffer index minus the count scrolled above. Conflating the two is
      // the off-by-N (one per line below the cursor) bug this mapping exists to prevent.
      const startIdx = Math.max(0, snap.lines.length - term.rows);
      const lines = reset ? snap.lines : snap.lines.slice(startIdx);
      const cursor = snap.cursor;

      if (reset) term.reset();
      term.scrollToBottom();
      const clearSeq = reset ? '' : '\x1b[1;1H\x1b[0J';
      const content = styledLinesToAnsi(lines);
      term.write(`\x1b[?25l${clearSeq}${content}`, () => {
        if (!cursor) {
          term.write('\x1b[?25h');
          return;
        }
        const { row, col } = cursorToViewport(cursor, startIdx, term.rows, term.cols);
        term.write(`\x1b[${row};${col}H\x1b[?25h`);
      });
    };

    // [LAW:no-ambient-temporal-coupling] xterm measures the character cell at open()/fit() time. If the
    // bundled web font is still loading then, the grid is sized against fallback metrics and stays wrong
    // until a resize. So the open→fit→wire sequence is owned by `start`, fired only once the font is
    // resolved — first paint is measured against the real glyph metrics, deterministically, not racing
    // the disk load. Idempotent collection of teardown so cleanup works whether or not start() ran.
    let disposed = false;
    const disposers: Array<() => void> = [];

    const start = () => {
      if (disposed || !containerRef.current) return;

      term.open(container);
      fitAddon.fit();

      const observer = new ResizeObserver(() => fitAddon.fit());
      observer.observe(container);
      disposers.push(() => observer.disconnect());

      const dataDisposable = term.onData((data) => {
        const sessionId = entityFocus.sessionId;
        if (!sessionId) return;
        void window.ipc.invoke('actions/send-text', {
          entity: entityFocus.selected,
          sessionId,
          text: data,
        });
      });
      disposers.push(() => dataDisposable.dispose());

      const dispose = autorun(() => {
        const snap = monitor.screen;
        if (!snap.sessionId) return;

        const isSessionChange = lastSessionId !== snap.sessionId;
        if (!isSessionChange && snap.updatesReceived === lastUpdatesReceived) return;

        lastUpdatesReceived = snap.updatesReceived;
        lastSessionId = snap.sessionId;

        render(isSessionChange);
      });
      disposers.push(dispose);
    };

    // Wait on both faces (regular + bold) of the bundled family before opening. document.fonts.load
    // resolves with the faces it matched; an empty result means the asset didn't package or the family
    // name drifted — text still renders via the fallback stack, but glyphs tofu, so say so loudly rather
    // than silently shipping the wrong font. [LAW:no-silent-failure] A rejection (load error) likewise
    // degrades to the fallback with a warning, never a blank viewport.
    const primary = primaryFamily(fontStack);
    void Promise.all([
      document.fonts.load(`400 ${FONT_SIZE}px '${primary}'`),
      document.fonts.load(`700 ${FONT_SIZE}px '${primary}'`),
    ]).then(
      (faces) => {
        if (faces.flat().length === 0) {
          console.warn(`[ScreenPane] bundled font "${primary}" did not load; powerline/devicon glyphs may render as tofu`);
        }
        start();
      },
      (err) => {
        console.warn(`[ScreenPane] bundled font "${primary}" failed to load; using fallback stack`, err);
        start();
      },
    );

    return () => {
      disposed = true;
      disposers.forEach((d) => d());
      term.dispose();
    };
  }, [entityFocus, monitor]);

  return <div ref={containerRef} className="h-full w-full" />;
});
