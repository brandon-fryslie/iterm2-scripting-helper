import { useState, useEffect } from 'react';
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
import type { OsascriptLanguage } from '@shared/rpc';

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

export const GetSelectionForm = observer(function GetSelectionForm() {
  const { console: c } = useStore();
  const f = c.forms['get-selection'];
  return (
    <div className="grid gap-2" data-testid="form-get-selection">
      <Field label="Session id">
        <Input
          value={f.sessionId}
          onChange={(e) => c.updateForm('get-selection', { sessionId: e.target.value })}
          placeholder="(empty = focused session)"
          data-testid="get-selection-session"
        />
      </Field>
      <p className="text-[10px] text-muted-foreground">
        Returns the current selection for the session. Copy the <code>selectionJson</code> payload from the
        activity log to paste into Set Selection.
      </p>
    </div>
  );
});

export const SetSelectionForm = observer(function SetSelectionForm() {
  const { console: c } = useStore();
  const f = c.forms['set-selection'];
  return (
    <div className="grid gap-2" data-testid="form-set-selection">
      <Field label="Session id">
        <Input
          value={f.sessionId}
          onChange={(e) => c.updateForm('set-selection', { sessionId: e.target.value })}
          placeholder="(empty = focused session)"
          data-testid="set-selection-session"
        />
      </Field>
      <Field label="Selection JSON">
        <Textarea
          value={f.selectionJson}
          onChange={(e) => c.updateForm('set-selection', { selectionJson: e.target.value })}
          rows={6}
          placeholder={'{"subSelections": []}'}
          className="font-mono text-xs"
          data-testid="set-selection-json"
        />
      </Field>
      <p className="text-[10px] text-muted-foreground">
        JSON-encoded <code>iterm2.Selection</code> proto. Use <code>{'{}'}</code> or{' '}
        <code>{'{"subSelections":[]}'}</code> to clear. Paste Get Selection output to restore a
        captured selection.
      </p>
    </div>
  );
});

export const TransactionForm = observer(function TransactionForm() {
  const { console: c } = useStore();
  const f = c.forms.transaction;
  return (
    <div className="grid gap-2" data-testid="form-transaction">
      <Field label="Operation">
        <Select
          value={f.op}
          onValueChange={(v) => c.updateForm('transaction', { op: v as typeof f.op })}
        >
          <SelectTrigger data-testid="transaction-op">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="begin">begin</SelectItem>
            <SelectItem value="end">end</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <p className="text-[10px] text-muted-foreground">
        Freezes iTerm2&apos;s main loop while in a transaction. Always end the transaction —
        leaving it open locks the app until it times out.
      </p>
    </div>
  );
});

// ─── Static AS ↔ Proto template pairs ──────────────────────────────────────
// Each entry shows an AppleScript (or JXA) script alongside the proto request that
// achieves the same effect. These are curated, not computed from script output.
interface OsascriptTemplate {
  name: string;
  language: OsascriptLanguage;
  script: string;
  protoNote: string | null;
  protoExample: string | null;
}

const OSASCRIPT_TEMPLATES: OsascriptTemplate[] = [
  {
    name: 'Get focused session id',
    language: 'AppleScript',
    script: 'tell application "iTerm2"\n  id of current session of current tab of current window\nend tell',
    protoNote: 'listSessionsRequest returns all sessions with their IDs',
    protoExample: '{ "submessage": { "listSessionsRequest": {} } }',
  },
  {
    name: 'Write text to session',
    language: 'AppleScript',
    script: 'tell application "iTerm2"\n  tell current session of current tab of current window\n    write text "echo hello"\n  end tell\nend tell',
    protoNote: 'sendTextRequest — same effect over the wire',
    protoExample: '{\n  "submessage": {\n    "sendTextRequest": {\n      "session": "<sessionId>",\n      "text": "echo hello"\n    }\n  }\n}',
  },
  {
    name: 'Create tab',
    language: 'AppleScript',
    script: 'tell application "iTerm2"\n  tell current window\n    create tab with default profile\n  end tell\nend tell',
    protoNote: null,
    protoExample: null,
  },
  {
    name: 'Split pane vertically',
    language: 'AppleScript',
    script: 'tell application "iTerm2"\n  tell current session of current tab of current window\n    split vertically with default profile\n  end tell\nend tell',
    protoNote: null,
    protoExample: null,
  },
  {
    name: 'Get session variable (JXA)',
    language: 'JavaScript',
    script: 'const iterm = Application("iTerm2")\nconst sess = iterm.currentWindow().currentTab().currentSession()\nsess.variable({name: "session.name"})',
    protoNote: 'monitor/probe-variable or a variable-subscription can read the same variable',
    protoExample: null,
  },
  {
    name: 'Write text (JXA)',
    language: 'JavaScript',
    script: 'Application("iTerm2").currentWindow().currentTab().currentSession().write({text: "echo hello\\n"})',
    protoNote: 'sendTextRequest over the wire',
    protoExample: '{\n  "submessage": {\n    "sendTextRequest": {\n      "session": "<sessionId>",\n      "text": "echo hello\\n"\n    }\n  }\n}',
  },
];

// ─── Sdef reference (lazy) ──────────────────────────────────────────────────

interface SdefClass {
  name: string;
  description: string;
  properties: { name: string; type: string; description: string }[];
}

interface SdefCommand {
  name: string;
  description: string;
}

interface SdefSummary {
  classes: SdefClass[];
  commands: SdefCommand[];
}

function parseSdef(xml: string): SdefSummary {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const classes = Array.from(doc.querySelectorAll('suite > class')).map((el) => ({
    name: el.getAttribute('name') ?? '',
    description: el.getAttribute('description') ?? '',
    properties: Array.from(el.querySelectorAll('property')).map((p) => ({
      name: p.getAttribute('name') ?? '',
      type: p.getAttribute('type') ?? '',
      description: p.getAttribute('description') ?? '',
    })),
  }));
  const commands = Array.from(doc.querySelectorAll('suite > command')).map((el) => ({
    name: el.getAttribute('name') ?? '',
    description: el.getAttribute('description') ?? '',
  }));
  return {
    classes: classes.filter((c) => c.name),
    commands: commands.filter((c) => c.name),
  };
}

export const OsascriptForm = observer(function OsascriptForm() {
  const { console: c } = useStore();
  const f = c.forms.osascript;

  // Templates panel
  const [showTemplates, setShowTemplates] = useState(false);

  // Sdef reference panel
  const [showSdef, setShowSdef] = useState(false);
  const [sdef, setSdef] = useState<SdefSummary | null>(null);
  const [sdefError, setSdefError] = useState<string | null>(null);
  const [sdefFilter, setSdefFilter] = useState('');

  // [LAW:no-ambient-temporal-coupling] fetch triggered by explicit user expansion, not by mount.
  useEffect(() => {
    if (!showSdef || sdef !== null || sdefError !== null) return;
    void window.ipc.invoke('workbench/sdef-text', undefined).then((res) => {
      if (res.text) {
        setSdef(parseSdef(res.text));
      } else {
        setSdefError('Could not load sdef — is iTerm2 installed at /Applications/iTerm.app?');
      }
    });
  }, [showSdef, sdef, sdefError]);

  const filterLower = sdefFilter.toLowerCase();
  const filteredClasses = sdef?.classes.filter(
    (cl) => !filterLower || cl.name.includes(filterLower) || cl.description.toLowerCase().includes(filterLower),
  );
  const filteredCommands = sdef?.commands.filter(
    (cmd) => !filterLower || cmd.name.includes(filterLower) || cmd.description.toLowerCase().includes(filterLower),
  );

  return (
    <div className="grid gap-2" data-testid="form-osascript">
      <Field label="Language">
        <Select
          value={f.language}
          onValueChange={(v) => c.updateForm('osascript', { language: v as OsascriptLanguage })}
        >
          <SelectTrigger data-testid="osascript-language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AppleScript">AppleScript</SelectItem>
            <SelectItem value="JavaScript">JavaScript (JXA)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Script">
        <Textarea
          value={f.script}
          onChange={(e) => c.updateForm('osascript', { script: e.target.value })}
          rows={7}
          placeholder={
            f.language === 'AppleScript'
              ? 'tell application "iTerm2"\n  ...\nend tell'
              : 'Application("iTerm2").currentWindow().currentTab().currentSession().write({text: "hello"})'
          }
          className="font-mono text-xs"
          data-testid="osascript-script"
        />
      </Field>

      {/* Templates */}
      <details
        open={showTemplates}
        onToggle={(e) => setShowTemplates((e.target as HTMLDetailsElement).open)}
        className="rounded border px-2 py-1"
        data-testid="osascript-templates"
      >
        <summary className="cursor-pointer text-xs font-medium select-none">
          Common scripts &amp; proto equivalents
        </summary>
        <div className="mt-2 grid gap-2">
          {OSASCRIPT_TEMPLATES.map((tpl) => (
            <div key={tpl.name} className="rounded border p-2 text-xs">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-medium">{tpl.name}</span>
                <span className="text-[10px] text-muted-foreground">{tpl.language}</span>
                <button
                  className="rounded bg-primary px-2 py-0.5 text-[10px] text-primary-foreground hover:bg-primary/90"
                  onClick={() =>
                    c.updateForm('osascript', { script: tpl.script, language: tpl.language })
                  }
                  data-testid={`osascript-tpl-${tpl.name.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  Use
                </button>
              </div>
              <pre className="mb-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                {tpl.script}
              </pre>
              {tpl.protoNote && (
                <p className="text-[10px] text-muted-foreground">
                  Proto equivalent: {tpl.protoNote}
                  {tpl.protoExample && (
                    <pre className="mt-0.5 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[10px] whitespace-pre-wrap">
                      {tpl.protoExample}
                    </pre>
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      </details>

      {/* Sdef reference */}
      <details
        open={showSdef}
        onToggle={(e) => setShowSdef((e.target as HTMLDetailsElement).open)}
        className="rounded border px-2 py-1"
        data-testid="osascript-sdef"
      >
        <summary className="cursor-pointer text-xs font-medium select-none">
          iTerm2 sdef reference (classes &amp; commands)
        </summary>
        <div className="mt-2">
          {sdefError && (
            <p className="text-[10px] text-destructive">{sdefError}</p>
          )}
          {!sdef && !sdefError && showSdef && (
            <p className="text-[10px] text-muted-foreground">Loading…</p>
          )}
          {sdef && (
            <>
              <Input
                value={sdefFilter}
                onChange={(e) => setSdefFilter(e.target.value)}
                placeholder="Filter classes or commands…"
                className="mb-2 h-6 text-xs"
                data-testid="osascript-sdef-filter"
              />
              <div className="max-h-56 overflow-y-auto text-xs space-y-1">
                {filteredClasses && filteredClasses.length > 0 && (
                  <div>
                    <p className="font-semibold text-[10px] uppercase text-muted-foreground mb-0.5">Classes</p>
                    {filteredClasses.map((cl) => (
                      <details key={cl.name} className="mb-0.5">
                        <summary className="cursor-pointer font-mono font-medium">
                          {cl.name}
                          {cl.description && (
                            <span className="ml-2 font-sans font-normal text-muted-foreground text-[10px]">
                              {cl.description}
                            </span>
                          )}
                        </summary>
                        {cl.properties.length > 0 && (
                          <ul className="ml-3 mt-0.5 space-y-0.5">
                            {cl.properties.map((p) => (
                              <li key={p.name} className="font-mono text-[10px]">
                                <span className="text-primary">{p.name}</span>
                                {p.type && <span className="text-muted-foreground"> : {p.type}</span>}
                                {p.description && (
                                  <span className="text-muted-foreground font-sans"> — {p.description}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    ))}
                  </div>
                )}
                {filteredCommands && filteredCommands.length > 0 && (
                  <div>
                    <p className="font-semibold text-[10px] uppercase text-muted-foreground mb-0.5">Commands</p>
                    {filteredCommands.map((cmd) => (
                      <div key={cmd.name} className="font-mono text-[10px]">
                        <span className="text-primary">{cmd.name}</span>
                        {cmd.description && (
                          <span className="text-muted-foreground font-sans ml-2">{cmd.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </details>
    </div>
  );
});
