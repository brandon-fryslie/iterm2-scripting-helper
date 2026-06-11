import { observer } from 'mobx-react-lite';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/stores/context';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[10rem_1fr] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div>{children}</div>
    </label>
  );
}

function Checkbox({
  checked,
  onChange,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      data-testid={testId}
      className="h-4 w-4"
    />
  );
}

export const SendTextForm = observer(function SendTextForm() {
  const { console: c } = useStore();
  const f = c.forms['send-text'];
  return (
    <div className="grid gap-2" data-testid="form-send-text">
      <Field label="Session override">
        <Input
          value={f.sessionId}
          placeholder={c.focusedSessionId || '(select a session)'}
          onChange={(e) => c.updateForm('send-text', { sessionId: e.target.value })}
          data-testid="send-text-session-input"
        />
      </Field>
      <Field label="Text">
        <Textarea
          value={f.text}
          onChange={(e) => c.updateForm('send-text', { text: e.target.value })}
          rows={3}
          placeholder="echo hello"
          data-testid="send-text-input"
        />
      </Field>
      <Field label="Suppress broadcast">
        <Checkbox
          checked={f.suppressBroadcast}
          onChange={(v) => c.updateForm('send-text', { suppressBroadcast: v })}
          testId="send-text-suppress"
        />
      </Field>
    </div>
  );
});

export const InjectForm = observer(function InjectForm() {
  const { console: c } = useStore();
  const f = c.forms.inject;
  return (
    <div className="grid gap-2" data-testid="form-inject">
      <Field label="Session override">
        <Input
          value={f.sessionId}
          placeholder={c.focusedSessionId || '(select a session)'}
          onChange={(e) => c.updateForm('inject', { sessionId: e.target.value })}
        />
      </Field>
      <Field label="Bytes (hex)">
        <Textarea
          value={f.bytesHex}
          onChange={(e) => c.updateForm('inject', { bytesHex: e.target.value })}
          rows={2}
          placeholder="1b5b33327d  (hex — whitespace ignored)"
          data-testid="inject-hex-input"
        />
      </Field>
    </div>
  );
});

export const ActivateForm = observer(function ActivateForm() {
  const { console: c } = useStore();
  const f = c.forms.activate;
  return (
    <div className="grid gap-2" data-testid="form-activate">
      <Field label="Target kind">
        <Select
          value={f.kind}
          onValueChange={(v) =>
            c.updateForm('activate', { kind: v as typeof f.kind })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="window">window</SelectItem>
            <SelectItem value="tab">tab</SelectItem>
            <SelectItem value="session">session</SelectItem>
            <SelectItem value="app">app only</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {f.kind !== 'app' && (
        <Field label="Target id">
          <Input
            value={f.id}
            placeholder={
              f.kind === 'session' ? c.focusedSessionId || '(selected session)' : ''
            }
            onChange={(e) => c.updateForm('activate', { id: e.target.value })}
            data-testid="activate-id-input"
          />
        </Field>
      )}
      <Field label="order window front">
        <Checkbox
          checked={f.orderWindowFront}
          onChange={(v) => c.updateForm('activate', { orderWindowFront: v })}
        />
      </Field>
      <Field label="select session">
        <Checkbox
          checked={f.selectSession}
          onChange={(v) => c.updateForm('activate', { selectSession: v })}
        />
      </Field>
      <Field label="select tab">
        <Checkbox
          checked={f.selectTab}
          onChange={(v) => c.updateForm('activate', { selectTab: v })}
        />
      </Field>
      <Field label="activate app">
        <Checkbox
          checked={f.activateApp}
          onChange={(v) => c.updateForm('activate', { activateApp: v })}
        />
      </Field>
    </div>
  );
});

export const MenuItemForm = observer(function MenuItemForm() {
  const { console: c } = useStore();
  const f = c.forms['menu-item'];
  return (
    <div className="grid gap-2" data-testid="form-menu-item">
      <Field label="Identifier">
        <Input
          value={f.identifier}
          onChange={(e) => c.updateForm('menu-item', { identifier: e.target.value })}
          placeholder="Session.New Tab"
        />
      </Field>
      <Field label="Query only">
        <Checkbox
          checked={f.queryOnly}
          onChange={(v) => c.updateForm('menu-item', { queryOnly: v })}
        />
      </Field>
    </div>
  );
});

export const InvokeFunctionForm = observer(function InvokeFunctionForm() {
  const { console: c } = useStore();
  const f = c.forms['invoke-function'];
  return (
    <div className="grid gap-2" data-testid="form-invoke-function">
      <Field label="Invocation">
        <Input
          value={f.invocation}
          onChange={(e) =>
            c.updateForm('invoke-function', { invocation: e.target.value })
          }
          placeholder='iterm2.run_tmux_command(command: "list-clients")'
        />
      </Field>
      <Field label="Scope">
        <Select
          value={f.scopeKind}
          onValueChange={(v) =>
            c.updateForm('invoke-function', { scopeKind: v as typeof f.scopeKind })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="app">app</SelectItem>
            <SelectItem value="session">session</SelectItem>
            <SelectItem value="tab">tab</SelectItem>
            <SelectItem value="window">window</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {f.scopeKind !== 'app' && (
        <Field label="Scope id">
          <Input
            value={f.scopeId}
            onChange={(e) => c.updateForm('invoke-function', { scopeId: e.target.value })}
            placeholder={f.scopeKind === 'session' ? c.focusedSessionId : ''}
          />
        </Field>
      )}
      <Field label="Timeout (s)">
        <Input
          type="number"
          value={f.timeout}
          onChange={(e) =>
            c.updateForm('invoke-function', { timeout: Number(e.target.value) || 0 })
          }
        />
      </Field>
    </div>
  );
});

export const RestartSessionForm = observer(function RestartSessionForm() {
  const { console: c } = useStore();
  const f = c.forms['restart-session'];
  return (
    <div className="grid gap-2" data-testid="form-restart-session">
      <Field label="Session override">
        <Input
          value={f.sessionId}
          placeholder={c.focusedSessionId || '(select a session)'}
          onChange={(e) =>
            c.updateForm('restart-session', { sessionId: e.target.value })
          }
        />
      </Field>
      <Field label="Only if exited">
        <Checkbox
          checked={f.onlyIfExited}
          onChange={(v) => c.updateForm('restart-session', { onlyIfExited: v })}
        />
      </Field>
    </div>
  );
});

export const CloseForm = observer(function CloseForm() {
  const { console: c } = useStore();
  const f = c.forms.close;
  return (
    <div className="grid gap-2" data-testid="form-close">
      <Field label="Kind">
        <Select
          value={f.kind}
          onValueChange={(v) => c.updateForm('close', { kind: v as typeof f.kind })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sessions">sessions</SelectItem>
            <SelectItem value="tabs">tabs</SelectItem>
            <SelectItem value="windows">windows</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Ids (csv)">
        <Input
          value={f.idsCsv}
          onChange={(e) => c.updateForm('close', { idsCsv: e.target.value })}
          placeholder="id1, id2, id3"
        />
      </Field>
      <Field label="Force">
        <Checkbox
          checked={f.force}
          onChange={(v) => c.updateForm('close', { force: v })}
        />
      </Field>
    </div>
  );
});

export const SavedArrangementForm = observer(function SavedArrangementForm() {
  const { console: c } = useStore();
  const f = c.forms['saved-arrangement'];
  return (
    <div className="grid gap-2" data-testid="form-saved-arrangement">
      <Field label="Operation">
        <Select
          value={f.op}
          onValueChange={(v) =>
            c.updateForm('saved-arrangement', { op: v as typeof f.op })
          }
        >
          <SelectTrigger data-testid="saved-arrangement-op">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="save">save</SelectItem>
            <SelectItem value="restore">restore</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Arrangement name">
        <Input
          value={f.name}
          onChange={(e) => c.updateForm('saved-arrangement', { name: e.target.value })}
          placeholder="dev layout"
          data-testid="saved-arrangement-name"
        />
      </Field>
      <Field label="Window id (optional)">
        <Input
          value={f.windowId}
          onChange={(e) => c.updateForm('saved-arrangement', { windowId: e.target.value })}
          placeholder={
            f.op === 'save'
              ? '(empty = save all windows; id = only that window)'
              : '(empty = restore as new windows; id = restore into that window)'
          }
          data-testid="saved-arrangement-window"
        />
      </Field>
    </div>
  );
});

export const SetBroadcastDomainsForm = observer(function SetBroadcastDomainsForm() {
  const { console: c } = useStore();
  const f = c.forms['set-broadcast-domains'];
  return (
    <div className="grid gap-2" data-testid="form-set-broadcast-domains">
      <Field label="Domains">
        <Textarea
          value={f.domainsText}
          onChange={(e) =>
            c.updateForm('set-broadcast-domains', { domainsText: e.target.value })
          }
          rows={5}
          placeholder={'one domain per line: session ids separated by commas or spaces\n(empty = clear all broadcast domains)'}
          className="font-mono text-xs"
          data-testid="set-broadcast-domains-text"
        />
      </Field>
      <p className="text-[10px] text-muted-foreground">
        Replaces the entire broadcast table. The Workbench's Broadcast Domains editor offers
        the same action with drag-and-drop.
      </p>
    </div>
  );
});

export const RawProtobufForm = observer(function RawProtobufForm() {
  const { console: c } = useStore();
  const f = c.forms['raw-protobuf'];
  return (
    <div className="grid gap-2" data-testid="form-raw-protobuf">
      <Field label="Envelope JSON">
        <Textarea
          value={f.envelopeJson}
          onChange={(e) =>
            c.updateForm('raw-protobuf', { envelopeJson: e.target.value })
          }
          rows={10}
          className="font-mono text-xs"
        />
      </Field>
    </div>
  );
});
