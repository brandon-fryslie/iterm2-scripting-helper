import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/stores/context';
import { FocusTarget } from './console/FocusTarget';
import type { ActionKind } from '@/stores/ConsoleStore';
import {
  SendTextForm,
  InjectForm,
  ActivateForm,
  MenuItemForm,
  InvokeFunctionForm,
  RestartSessionForm,
  CloseForm,
  RawProtobufForm,
} from './console/ActionForms';

const ACTIONS: Array<{ kind: ActionKind; label: string }> = [
  { kind: 'send-text', label: 'Send text' },
  { kind: 'inject', label: 'Inject' },
  { kind: 'activate', label: 'Activate' },
  { kind: 'menu-item', label: 'Menu item' },
  { kind: 'invoke-function', label: 'Invoke function' },
  { kind: 'restart-session', label: 'Restart' },
  { kind: 'close', label: 'Close' },
  { kind: 'raw-protobuf', label: 'Raw protobuf' },
];

const FORM_COMPONENTS: Record<ActionKind, React.ComponentType> = {
  'send-text': SendTextForm,
  inject: InjectForm,
  activate: ActivateForm,
  'menu-item': MenuItemForm,
  'invoke-function': InvokeFunctionForm,
  'restart-session': RestartSessionForm,
  close: CloseForm,
  'raw-protobuf': RawProtobufForm,
};

export const ConsoleTab = observer(function ConsoleTab() {
  const { console: consoleStore, monitor } = useStore();
  const [snippetName, setSnippetName] = useState('');

  useEffect(() => {
    if (monitor.layout.windows.length === 0) {
      void monitor.hydrate();
    }
    // The transcript is a projection of the main-process spine; pull the current state on mount so
    // actions fired in a prior view of this session are present.
    void consoleStore.refreshTranscript();
  }, [monitor, consoleStore]);

  const Form = FORM_COMPONENTS[consoleStore.selectedAction];

  return (
    <div className="grid gap-4" data-testid="tab-console-placeholder">
      <FocusTarget />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Action</CardTitle>
          <div className="flex flex-wrap gap-1">
            {ACTIONS.map((a) => (
              <Button
                key={a.kind}
                size="sm"
                variant={consoleStore.selectedAction === a.kind ? 'default' : 'outline'}
                onClick={() => consoleStore.setAction(a.kind)}
                data-testid={`action-${a.kind}`}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Form />
          <Separator className="my-3" />
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void consoleStore.fire(consoleStore.selectedAction)}
              data-testid="action-fire"
            >
              Fire
            </Button>
            <Input
              value={snippetName}
              onChange={(e) => setSnippetName(e.target.value)}
              placeholder="Snippet name (optional)"
              className="max-w-[240px]"
              data-testid="snippet-name"
            />
            <Button
              variant="secondary"
              onClick={() => {
                consoleStore.saveSnippet(snippetName);
                setSnippetName('');
              }}
              data-testid="snippet-save"
            >
              Save as snippet
            </Button>
          </div>
        </CardContent>
      </Card>

      {consoleStore.snippets.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Snippets</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {consoleStore.snippets.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2"
                  data-testid={`snippet-${s.id}`}
                >
                  <Badge variant="outline">{s.action}</Badge>
                  <span className="flex-1 truncate">{s.name}</span>
                  <Button
                    size="sm"
                    onClick={() => void consoleStore.fireSnippet(s.id)}
                    data-testid={`snippet-fire-${s.id}`}
                  >
                    Fire
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => consoleStore.deleteSnippet(s.id)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Transcript</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {consoleStore.transcript.length} entry(s)
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => consoleStore.clearTranscript()}
            >
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent className="max-h-[40vh] overflow-auto">
          {consoleStore.transcript.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Fire an action to log its request + response here.
            </p>
          ) : (
            <ul className="space-y-2 font-mono text-xs">
              {consoleStore.transcript
                .slice()
                .reverse()
                .map((e) => (
                  <li
                    key={e.id}
                    className="rounded border p-2"
                    data-testid={`transcript-${e.id}`}
                    data-ok={e.result.ok ? 'true' : 'false'}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{e.action}</Badge>
                      <Badge variant={e.result.ok ? 'default' : 'destructive'}>
                        {e.result.ok ? 'ok' : 'error'}
                      </Badge>
                      <span className="text-muted-foreground">
                        {e.result.latencyMs} ms
                      </span>
                      <span className="ml-auto text-muted-foreground">
                        {new Date(e.at).toISOString().slice(11, 23)}
                      </span>
                    </div>
                    <details className="mt-1 text-muted-foreground">
                      <summary className="cursor-pointer">args</summary>
                      <pre className="mt-1 whitespace-pre-wrap">
                        {JSON.stringify(e.args, null, 2)}
                      </pre>
                    </details>
                    {e.result.error && (
                      <div className="mt-1 text-destructive">{e.result.error}</div>
                    )}
                    {e.result.payload && (
                      <details className="mt-1 text-muted-foreground">
                        <summary className="cursor-pointer">
                          response ({e.result.responseCase ?? '—'})
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap">
                          {JSON.stringify(e.result.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
