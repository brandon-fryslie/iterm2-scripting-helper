import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useStore } from '@/stores/context';
import {
  decodeBindingKey,
  formatKeystroke,
  keyActionName,
  encodeKeystrokeFromBrowser,
  type DecodedKeystroke,
} from '@shared/keyBindings';
import type { KeyBindingEntry, SnippetEntry } from '@shared/rpc';

// Scripting/API view for key bindings and snippets (449.8 lens): iTerm2 Settings is the
// canonical editor. This surface shows the raw GlobalKeyMap encoding (decode → human-readable
// representation), paste configuration from the defaults domain, and the snippet inventory —
// the facts useful to a script author, not a second human binding editor.
export const KeyBindingsViewer = observer(function KeyBindingsViewer() {
  const { workbench } = useStore();

  useEffect(() => {
    if (workbench.keyBindings === null) void workbench.refreshKeyBindings();
  }, [workbench]);

  const snap = workbench.keyBindings;

  return (
    <div className="grid gap-4" data-testid="workbench-key-bindings">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Key Bindings &amp; Snippets</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void workbench.refreshKeyBindings()}
            data-testid="key-bindings-refresh"
          >
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p className="text-xs text-muted-foreground">
            Global key bindings and snippets are read from the{' '}
            <code>com.googlecode.iterm2</code> defaults domain (same source as{' '}
            <em>Settings → Keys</em>). iTerm2 Settings is the canonical editor; this view
            exposes the raw encoding, action types, and snippet identifiers for scripting.
          </p>
          {snap && !snap.ok && (
            <Badge variant="destructive" data-testid="key-bindings-error">
              defaults read failed: {snap.error}
            </Badge>
          )}
        </CardContent>
      </Card>

      <KeystrokeEncoder />

      {snap === null ? (
        <p className="text-xs text-muted-foreground" data-testid="key-bindings-loading">
          Loading…
        </p>
      ) : snap.ok ? (
        <>
          <GlobalKeyMapCard bindings={snap.globalBindings} />
          <SnippetsCard snippets={snap.snippets} />
          {Object.keys(snap.pasteConfig).length > 0 && (
            <PasteConfigCard config={snap.pasteConfig} />
          )}
        </>
      ) : null}
    </div>
  );
});

// Live keystroke → iTerm2 encoding tool. Captures one keydown, shows the encoding the user
// would enter in GlobalKeyMap to bind that keystroke.
function KeystrokeEncoder() {
  const [captured, setCaptured] = useState<{
    encoded: string;
    decoded: DecodedKeystroke;
    readable: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Let Tab/Shift/Ctrl/Alt/Cmd through for the capture but prevent default browser behavior.
    e.preventDefault();
    e.stopPropagation();
    const result = encodeKeystrokeFromBrowser({
      key: e.key,
      code: e.code,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
    if (!result) return;
    setCaptured({
      encoded: result.encoded,
      decoded: result.decoded,
      readable: formatKeystroke(result.decoded),
    });
    setCopied(false);
  };

  const copyEncoded = () => {
    if (!captured) return;
    void navigator.clipboard.writeText(captured.encoded).then(() => setCopied(true));
  };

  return (
    <Card data-testid="keystroke-encoder">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Keystroke Encoder</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Press any key in the field below to see its iTerm2 GlobalKeyMap encoding. Use the
          encoded string as the key when building or inspecting GlobalKeyMap entries via the
          Preferences API.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            ref={inputRef}
            value={captured?.readable ?? ''}
            readOnly
            placeholder="Click here and press a key…"
            onKeyDown={handleKeyDown}
            className="max-w-[260px] font-mono"
            data-testid="keystroke-encoder-input"
          />
          {captured && (
            <>
              <code
                className="rounded bg-muted px-2 py-1 font-mono text-xs"
                data-testid="keystroke-encoder-encoded"
              >
                {captured.encoded}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={copyEncoded}
                data-testid="keystroke-encoder-copy"
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </>
          )}
        </div>
        {captured && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <span>char</span>
            <span>
              {captured.decoded.hexChar} — {captured.decoded.key}
            </span>
            <span>modifiers</span>
            <span>
              {captured.decoded.hexMods}
              {captured.decoded.modifiers.length > 0
                ? ` (${captured.decoded.modifiers.join(', ')})`
                : ' (none)'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GlobalKeyMapCard({ bindings }: { bindings: KeyBindingEntry[] }) {
  const [filter, setFilter] = useState('');
  const [exported, setExported] = useState(false);

  const visible = filter
    ? bindings.filter(
        (b) =>
          b.key.includes(filter) ||
          keyActionName(b.action).toLowerCase().includes(filter.toLowerCase()) ||
          b.parameter.toLowerCase().includes(filter.toLowerCase()) ||
          b.label.toLowerCase().includes(filter.toLowerCase()),
      )
    : bindings;

  const exportJson = () => {
    void navigator.clipboard.writeText(JSON.stringify(bindings, null, 2)).then(() =>
      setExported(true),
    );
  };

  return (
    <Card data-testid="global-key-map">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Global Key Map{' '}
          <span className="font-normal text-muted-foreground text-sm">
            ({bindings.length} binding{bindings.length !== 1 ? 's' : ''})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by key, action, or parameter…"
            className="max-w-[320px]"
            data-testid="key-map-filter"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={exportJson}
            data-testid="key-map-export"
          >
            {exported ? 'Copied JSON' : 'Export JSON'}
          </Button>
        </div>

        {bindings.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="key-map-empty">
            No global key bindings found in the defaults domain.
          </p>
        ) : (
          <ul className="grid gap-1" data-testid="key-map-list">
            {visible.map((entry) => (
              <KeyBindingRow key={entry.key} entry={entry} />
            ))}
            {filter && visible.length === 0 && (
              <li className="text-xs text-muted-foreground">No matches.</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function KeyBindingRow({ entry }: { entry: KeyBindingEntry }) {
  const decoded = decodeBindingKey(entry.key);
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 font-mono text-[10px]"
      data-testid={`key-binding-${entry.key}`}
    >
      <span className="min-w-[120px] font-bold">
        {decoded ? formatKeystroke(decoded) : entry.key}
      </span>
      <Badge variant="outline" className="shrink-0">
        {keyActionName(entry.action)}
      </Badge>
      {entry.parameter && (
        <span className="text-muted-foreground truncate max-w-[200px]" title={entry.parameter}>
          {entry.parameter}
        </span>
      )}
      {entry.label && (
        <span className="text-muted-foreground italic">{entry.label}</span>
      )}
      <span className="ml-auto shrink-0 text-muted-foreground">{entry.key}</span>
    </li>
  );
}

function SnippetsCard({ snippets }: { snippets: SnippetEntry[] }) {
  const [exported, setExported] = useState(false);

  const exportJson = () => {
    void navigator.clipboard.writeText(JSON.stringify(snippets, null, 2)).then(() =>
      setExported(true),
    );
  };

  return (
    <Card data-testid="snippets-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Snippets{' '}
          <span className="font-normal text-muted-foreground text-sm">
            ({snippets.length} snippet{snippets.length !== 1 ? 's' : ''})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground flex-1">
            Snippets are identified by title; the <code>Value</code> field is what gets pasted.
            Use the Paste Special action (action 19 or 20) with a snippet title to invoke one
            from a key binding.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={exportJson}
            data-testid="snippets-export"
          >
            {exported ? 'Copied JSON' : 'Export JSON'}
          </Button>
        </div>

        {snippets.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="snippets-empty">
            No snippets found in the defaults domain.
          </p>
        ) : (
          <ul className="grid gap-1" data-testid="snippets-list">
            {snippets.map((s, idx) => (
              <li
                key={idx}
                className="flex flex-wrap items-start gap-2 rounded border px-2 py-1.5 text-xs"
                data-testid={`snippet-${idx}`}
              >
                <span className="font-medium">{s.title}</span>
                {s.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
                <span className="w-full font-mono text-[10px] text-muted-foreground truncate">
                  {s.value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PasteConfigCard({ config }: { config: Record<string, unknown> }) {
  return (
    <Card data-testid="paste-config-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Paste Configuration</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground">
          Paste-related preference keys from the defaults domain. These control how "Paste
          Special" key actions behave and are readable via the Preferences API
          (<code>PreferencesRequest.GetPreference</code>).
        </p>
        <ul className="grid gap-1 font-mono text-[10px]" data-testid="paste-config-list">
          {Object.entries(config).map(([key, value]) => (
            <li key={key} className="flex gap-2 rounded border px-2 py-1">
              <span className="shrink-0 text-muted-foreground">{key}</span>
              <span className="ml-auto">{JSON.stringify(value)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
