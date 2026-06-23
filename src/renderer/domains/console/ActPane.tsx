import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/stores/context';
import { FocusTarget } from './FocusTarget';
import { FiredResult } from './FiredResult';
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
  SetBroadcastDomainsForm,
  GetSelectionForm,
  SetSelectionForm,
  TransactionForm,
  OsascriptForm,
  RawProtobufForm,
  TmuxSendCommandForm,
  TmuxCreateWindowForm,
  TmuxSetWindowVisibleForm,
  GetPreferenceForm,
  ApplyColorPresetForm,
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
  { kind: 'set-broadcast-domains', label: 'Broadcast' },
  { kind: 'get-selection', label: 'Get selection' },
  { kind: 'set-selection', label: 'Set selection' },
  { kind: 'transaction', label: 'Transaction' },
  { kind: 'osascript', label: 'AppleScript/JXA' },
  { kind: 'tmux-send-command', label: 'tmux command' },
  { kind: 'tmux-create-window', label: 'tmux window' },
  { kind: 'tmux-set-window-visible', label: 'tmux visibility' },
  { kind: 'get-preference', label: 'Get preference' },
  { kind: 'apply-color-preset', label: 'Color preset' },
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
  'set-broadcast-domains': SetBroadcastDomainsForm,
  'get-selection': GetSelectionForm,
  'set-selection': SetSelectionForm,
  transaction: TransactionForm,
  osascript: OsascriptForm,
  'tmux-send-command': TmuxSendCommandForm,
  'tmux-create-window': TmuxCreateWindowForm,
  'tmux-set-window-visible': TmuxSetWindowVisibleForm,
  'get-preference': GetPreferenceForm,
  'apply-color-preset': ApplyColorPresetForm,
  'raw-protobuf': RawProtobufForm,
};

// Act: the contextual action bar over the focused entity. Firing an action produces an AppEvent on the
// shared spine; the FiredResult panel below surfaces that just-fired event and its provenance inline,
// so cause/effect is one glance here instead of a switch to the Events lens.
//
// [LAW:no-ambient-temporal-coupling] This pane is the Console lens's spine-refresh owner: it hydrates
// the ActivityStore once on mount (the shell keeps it live for the Events lens but does not poll it
// here) and again right after each fire, so the inline result reads a snapshot that provably includes
// the event the fire just appended.
export const ActPane = observer(function ActPane() {
  const { console: consoleStore, activity } = useStore();
  const [snippetName, setSnippetName] = useState('');

  useEffect(() => {
    void activity.hydrate();
  }, [activity]);

  const fireAction = async (action: ActionKind) => {
    await consoleStore.fire(action);
    await activity.hydrate();
  };

  const fireSnippet = async (id: string) => {
    await consoleStore.fireSnippet(id);
    await activity.hydrate();
  };

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
              onClick={() => void fireAction(consoleStore.selectedAction)}
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

      <FiredResult />

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
                    onClick={() => void fireSnippet(s.id)}
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
