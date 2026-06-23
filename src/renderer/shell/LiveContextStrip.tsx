import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { screenContextForFocus } from '@/domains/monitor/screenContext';
import {
  CONNECTION_STATE_LABEL,
  connectionStateVariant,
} from '@/domains/settings/connectionState';
import { useStore } from '@/stores/context';

// The persistent live context strip. It is mounted by the shell — never inside a lens — so the
// experiment→observe loop survives a lens switch: fire on the Console lens, glance here, and the focused
// entity, its screen cursor/line-count, and the connection state are still in view.
// [LAW:effects-at-boundaries] Pure presentation. It owns no subscription and runs no effect; the shell
// (EntityWorkspace) is the single lifecycle owner that hydrates and keeps these stores live regardless
// of which lens is focal, so this strip only reads them. [LAW:dataflow-not-control-flow] Each segment is
// a function of always-live store values — the strip renders the same three segments every frame and
// varies only the values inside them (a discriminated screen descriptor, a connection-state label), so
// switching lenses never adds or removes a segment.
export const LiveContextStrip = observer(function LiveContextStrip() {
  const { entityFocus, monitor, connection } = useStore();
  const screen = screenContextForFocus(entityFocus.sessionId, monitor.screen);
  const state = connection.snapshot?.state ?? 'idle';

  return (
    <div
      className="flex items-center gap-4 border-t bg-muted/40 px-3 py-1 text-xs"
      data-testid="live-context-strip"
    >
      <div className="flex min-w-0 items-center gap-2" data-testid="strip-focus">
        <span className="text-muted-foreground">focus</span>
        <Badge variant="outline">{entityFocus.kind}</Badge>
        <code className="min-w-0 truncate">{entityFocus.key}</code>
      </div>

      <div
        className="flex items-center gap-2"
        data-testid="strip-screen"
        data-screen-status={screen.status}
      >
        <span className="text-muted-foreground">screen</span>
        <ScreenSummary screen={screen} />
      </div>

      <div className="ml-auto flex items-center gap-2" data-testid="strip-connection">
        <span className="text-muted-foreground">connection</span>
        <Badge
          variant={connectionStateVariant(state)}
          data-testid="strip-connection-badge"
          data-state={state}
        >
          {CONNECTION_STATE_LABEL[state]}
        </Badge>
      </div>
    </div>
  );
});

function ScreenSummary({
  screen,
}: {
  screen: ReturnType<typeof screenContextForFocus>;
}) {
  switch (screen.status) {
    case 'none':
      return <span className="text-muted-foreground">no session</span>;
    case 'pending':
      return <Badge variant="secondary">{screen.sessionId.slice(0, 12)}… loading</Badge>;
    case 'live':
      return (
        <>
          <Badge variant="secondary">{screen.lineCount} lines</Badge>
          <Badge variant="outline">
            cursor{' '}
            {screen.cursor ? `(${screen.cursor.x}, ${screen.cursor.y})` : '—'}
          </Badge>
        </>
      );
  }
}
