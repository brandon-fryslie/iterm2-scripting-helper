import { observer } from 'mobx-react-lite';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/stores/context';
import {
  APP_ENTITY,
  flatSessions,
  sessionEntityRef,
  type AppEntitySessionRef,
} from '@shared/domain';

export const SessionPicker = observer(function SessionPicker() {
  const root = useStore();
  const { entityFocus, monitor } = root;
  const sessions: Array<{
    sessionId: string;
    label: string;
    entity: AppEntitySessionRef;
  }> = [];
  for (const w of monitor.layout.windows) {
    for (const t of w.tabs) {
      for (const s of flatSessions(t)) {
        sessions.push({
          sessionId: s.sessionId,
          label: s.title || `tab ${t.tabId} · ${s.sessionId.slice(0, 8)}…`,
          entity: sessionEntityRef(w, t, s),
        });
      }
    }
  }

  const value = entityFocus.sessionId || '(none)';

  return (
    <div className="flex items-center gap-2" data-testid="console-session-picker">
      <label className="text-xs text-muted-foreground">Session</label>
      <Select
        value={value}
        onValueChange={(v) => {
          const next = sessions.find((s) => s.sessionId === v)?.entity ?? APP_ENTITY;
          void root.selectEntityFocus(next);
        }}
      >
        <SelectTrigger className="w-[360px]">
          <SelectValue placeholder="Pick a session…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="(none)">— none —</SelectItem>
          {sessions.map((s) => (
            <SelectItem key={s.sessionId} value={s.sessionId}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">
        {sessions.length} session(s) available
      </span>
    </div>
  );
});
