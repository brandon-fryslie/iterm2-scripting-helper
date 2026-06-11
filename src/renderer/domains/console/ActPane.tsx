import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/stores/context';
import { FocusTarget } from './FocusTarget';
import type { ActionKind } from '@/stores/ConsoleStore';
import {
  SendTextForm,
  InjectForm,
  ActivateForm,
  MenuItemForm,
  InvokeFunctionForm,
  RestartSessionForm,
  CloseForm,
  SavedArrangementForm,
  RawProtobufForm,
} from './ActionForms';

const ACTIONS: Array<{ kind: ActionKind; label: string }> = [
  { kind: 'send-text', label: 'Send text' },
  { kind: 'inject', label: 'Inject' },
  { kind: 'activate', label: 'Activate' },
  { kind: 'menu-item', label: 'Menu item' },
  { kind: 'invoke-function', label: 'Invoke function' },
  { kind: 'restart-session', label: 'Restart' },
  { kind: 'close', label: 'Close' },
  { kind: 'saved-arrangement', label: 'Arrangement' },
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
  'saved-arrangement': SavedArrangementForm,
  'raw-protobuf': RawProtobufForm,
};

// Act: the contextual action bar over the focused entity. Firing an action produces an AppEvent on the
// spine, so there is no Act-local transcript — the result surfaces in the Activity facet.
export const ActPane = observer(function ActPane() {
  const { console: consoleStore } = useStore();
  const [snippetName, setSnippetName] = useState('');

  const Form = FORM_COMPONENTS[consoleStore.selectedAction];

  return (
    <div className="grid gap-4 p-3" data-testid="act-pane">
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
    </div>
  );
});
