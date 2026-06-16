import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { autorun } from 'mobx';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useStore } from '@/stores/context';
import { styledLinesToAnsi, cursorToViewport } from './screenToAnsi';
import { Badge } from '@/components/ui/badge';

export const ScreenPane = observer(function ScreenPane() {
  const { entityFocus, monitor } = useStore();
  const focused = entityFocus.sessionId;
  const snap = monitor.screen;

  if (!focused) {
    return (
      <div
        className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="screen-pane"
        data-empty="true"
      >
        Select a session in Layout to render its screen.
      </div>
    );
  }

  if (snap.sessionId !== focused || snap.lines.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="screen-pane"
        data-empty="loading"
      >
        Rendering {focused.slice(0, 12)}…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="screen-pane">
      <div className="flex items-center gap-2 border-b px-3 py-1 text-xs">
        <code className="text-muted-foreground">{focused.slice(0, 12)}…</code>
        <Badge variant="secondary">{snap.lines.length} lines</Badge>
        {snap.cursor && (
          <Badge variant="outline">
            cursor ({snap.cursor.x}, {snap.cursor.y})
          </Badge>
        )}
        <Badge variant="outline">updates: {snap.updatesReceived}</Badge>
      </div>
      <XTermScreen />
    </div>
  );
});

const XTermScreen = observer(function XTermScreen() {
  const { entityFocus, monitor } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      convertEol: true,
      scrollback: 1000,
      cursorBlink: true,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    fitAddon.fit();

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(container);

    const dataDisposable = term.onData((data) => {
      const sessionId = entityFocus.sessionId;
      if (!sessionId) return;
      void window.ipc.invoke('actions/send-text', {
        entity: entityFocus.selected,
        sessionId,
        text: data,
      });
    });

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

    const dispose = autorun(() => {
      const snap = monitor.screen;
      if (!snap.sessionId) return;

      const isSessionChange = lastSessionId !== snap.sessionId;
      if (!isSessionChange && snap.updatesReceived === lastUpdatesReceived) return;

      lastUpdatesReceived = snap.updatesReceived;
      lastSessionId = snap.sessionId;

      render(isSessionChange);
    });

    return () => {
      dispose();
      dataDisposable.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [entityFocus, monitor]);

  return <div ref={containerRef} className="h-full w-full" />;
});
