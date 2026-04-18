import { observer } from 'mobx-react-lite';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/stores/context';

export const SessionPicker = observer(function SessionPicker() {
  const { monitor, console: consoleStore } = useStore();
  const sessions: Array<{ sessionId: string; label: string }> = [];
  for (const w of monitor.layout.windows) {
    for (const t of w.tabs) {
      for (const s of t.sessions) {
        sessions.push({
          sessionId: s.sessionId,
          label: `tab ${t.tabId} · ${s.sessionId.slice(0, 8)}…`,
        });
      }
    }
  }

  const value = consoleStore.focusedSessionId || '(none)';

  return (
    <div className="flex items-center gap-2" data-testid="console-session-picker">
      <label className="text-xs text-muted-foreground">Session</label>
      <Select
        value={value}
        onValueChange={(v) => consoleStore.setFocusedSessionId(v === '(none)' ? '' : v)}
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
