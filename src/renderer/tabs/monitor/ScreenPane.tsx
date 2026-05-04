import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { autorun } from 'mobx';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useStore } from '@/stores/context';
import { styledLinesToAnsi } from './screenToAnsi';
import { Badge } from '@/components/ui/badge';

export const ScreenPane = observer(function ScreenPane() {
  const { monitor } = useStore();
  const focused = monitor.focusSessionId;
  const snap = monitor.screen;

  if (!focused) {
    return (
      <div
        className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        data-testid="screen-pane"
        data-empty="true"
      >
        Click a session in Layout to render its screen.
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
  const { monitor } = useStore();
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
        background: '#0b1120',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        selectionBackground: '#404040',
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
      const sessionId = monitor.focusSessionId;
      if (!sessionId) return;
      void window.ipc.invoke('actions/send-text', { sessionId, text: data });
    });

    let lastSessionId: string | null = null;
    let lastUpdatesReceived = -1;

    const renderFull = () => {
      const snap = monitor.screen;
      if (!snap.lines || snap.lines.length === 0) return;
      term.reset();
      const content = styledLinesToAnsi(snap.lines, null, term.cols);
      const cursor = snap.cursor;
      term.write(`\x1b[?25l${content}`, () => {
        if (cursor) {
          const row = Math.min(cursor.y + 1, snap.lines.length);
          const col = Math.min(cursor.x + 1, term.cols);
          term.write(`\x1b[${row};${col}H\x1b[?25h`);
        } else {
          term.write('\x1b[?25h');
        }
      });
    };

    const renderIncremental = () => {
      const snap = monitor.screen;
      if (!snap.lines || snap.lines.length === 0) return;
      const rows = term.rows;
      if (rows === 0) return;
      term.scrollToBottom();
      const startIdx = Math.max(0, snap.lines.length - rows);
      const visibleLines = snap.lines.slice(startIdx);
      const cursor = snap.cursor
        ? { x: snap.cursor.x, y: Math.max(0, snap.cursor.y - startIdx) }
        : null;
      const content = styledLinesToAnsi(visibleLines, null, term.cols);
      term.write(`\x1b[?25l\x1b[1;1H\x1b[0J${content}`, () => {
        if (cursor) {
          const row = Math.min(cursor.y + 1, visibleLines.length);
          const col = Math.min(cursor.x + 1, term.cols);
          term.write(`\x1b[${row};${col}H\x1b[?25h`);
        } else {
          term.write('\x1b[?25h');
        }
      });
    };

    const dispose = autorun(() => {
      const snap = monitor.screen;
      if (!snap.sessionId) return;

      const isSessionChange = lastSessionId !== snap.sessionId;
      if (!isSessionChange && snap.updatesReceived === lastUpdatesReceived) return;

      lastUpdatesReceived = snap.updatesReceived;
      lastSessionId = snap.sessionId;

      if (isSessionChange) {
        renderFull();
      } else {
        renderIncremental();
      }
    });

    return () => {
      dispose();
      dataDisposable.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [monitor]);

  return <div ref={containerRef} className="h-full w-full" />;
});
