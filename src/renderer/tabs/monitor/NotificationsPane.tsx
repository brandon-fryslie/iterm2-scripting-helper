import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStore } from '@/stores/context';
import type { NotificationKind } from '@shared/rpc';

const KIND_FILTERS: Array<'all' | NotificationKind> = [
  'all',
  'keystroke',
  'prompt',
  'new-session',
  'terminate-session',
  'layout-changed',
  'focus-changed',
  'variable-changed',
  'custom-escape',
  'broadcast-changed',
  'profile-changed',
];

export const NotificationsPane = observer(function NotificationsPane() {
  const { monitor } = useStore();
  const entries = monitor.filteredNotifications;
  const total = monitor.notifications.totalSeen;
  const focused = monitor.focusSessionId;

  return (
    <div className="flex h-full flex-col" data-testid="notifications-pane">
      <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          {total} seen
          {focused ? ` · filtered by session ${focused.slice(0, 8)}…` : ''}
        </span>
        <span className="ml-auto" />
        {KIND_FILTERS.map((k) => (
          <Button
            key={k}
            size="sm"
            variant={monitor.notificationKindFilter === k ? 'default' : 'outline'}
            onClick={() => monitor.setNotificationKindFilter(k)}
            data-testid={`notification-filter-${k}`}
          >
            {k}
          </Button>
        ))}
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No matching notifications.
          </div>
        ) : (
          <ul>
            {entries.slice(-400).reverse().map((e) => (
              <li
                key={e.seq}
                className="flex items-start gap-2 border-b px-3 py-1"
                data-testid={`notification-entry-${e.seq}`}
                data-kind={e.kind}
              >
                <span className="text-muted-foreground">
                  {new Date(e.at).toISOString().slice(11, 23)}
                </span>
                <Badge variant="outline">{e.kind}</Badge>
                {e.sessionId && (
                  <span className="text-muted-foreground">
                    {e.sessionId.slice(0, 8)}…
                  </span>
                )}
                <span className="truncate">{e.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});
