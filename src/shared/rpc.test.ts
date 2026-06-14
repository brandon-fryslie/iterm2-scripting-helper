import { describe, it, expectTypeOf } from 'vitest';
import type {
  RpcSchema,
  RpcMethod,
  RpcArgs,
  RpcResult,
  EventSchema,
  EventKind,
} from './rpc';

describe('RpcSchema', () => {
  it('includes system/ping, connection/*, monitor/*, actions/*', () => {
    expectTypeOf<RpcMethod>().toEqualTypeOf<
      | 'system/ping'
      | 'connection/snapshot'
      | 'connection/connect'
      | 'connection/disconnect'
      | 'connection/list-sessions'
      | 'monitor/layout'
      | 'monitor/variables'
      | 'monitor/events'
      | 'monitor/focus-session'
      | 'monitor/focus-variables'
      | 'monitor/probe-variable'
      | 'monitor/watchlist'
      | 'monitor/set-watched'
      | 'monitor/screen'
      | 'actions/send-text'
      | 'actions/inject'
      | 'actions/activate'
      | 'actions/menu-item'
      | 'actions/invoke-function'
      | 'actions/restart-session'
      | 'actions/close'
      | 'actions/saved-arrangement'
      | 'actions/set-broadcast-domains'
      | 'actions/get-selection'
      | 'actions/set-selection'
      | 'actions/transaction'
      | 'actions/osascript'
      | 'actions/raw-protobuf'
      | 'actions/tmux-send-command'
      | 'actions/tmux-create-window'
      | 'actions/tmux-set-window-visible'
      | 'workbench/list-profiles'
      | 'workbench/dynamic-profiles'
      | 'workbench/save-dynamic-profile'
      | 'workbench/delete-dynamic-profile'
      | 'workbench/register-rpc'
      | 'workbench/unregister-rpc'
      | 'workbench/registrations'
      | 'workbench/subscribe-custom-escape'
      | 'workbench/unsubscribe-custom-escape'
      | 'workbench/custom-escape'
      | 'workbench/arrangements'
      | 'workbench/broadcast-domains'
      | 'workbench/key-bindings'
      | 'workbench/sdef-text'
      | 'workbench/tmux-connections'
    >();
  });

  it('system/ping shape', () => {
    expectTypeOf<RpcArgs<'system/ping'>>().toEqualTypeOf<void>();
    expectTypeOf<RpcResult<'system/ping'>>().toEqualTypeOf<{
      ok: true;
      now: number;
      electron: string;
    }>();
  });

  it('connection/snapshot returns a ConnectionSnapshot', () => {
    const s = {} as RpcResult<'connection/snapshot'>;
    expectTypeOf(s.state).toEqualTypeOf<
      | 'idle'
      | 'detecting'
      | 'requesting-cookie'
      | 'connecting'
      | 'ready'
      | 'error'
    >();
    expectTypeOf(s.protocolVersion).toEqualTypeOf<string>();
  });

  it('monitor/focus-session takes a sessionId', () => {
    expectTypeOf<RpcArgs<'monitor/focus-session'>>().toEqualTypeOf<{
      sessionId: string | null;
    }>();
  });

  it('monitor/focus-variables takes an entity focus', () => {
    expectTypeOf<RpcArgs<'monitor/focus-variables'>>().toEqualTypeOf<{
      entity: { kind: 'app' } | {
        kind: 'window';
        windowId: string;
      } | {
        kind: 'tab';
        windowId: string;
        tabId: string;
      } | {
        kind: 'session';
        windowId: string;
        tabId: string;
        sessionId: string;
      };
    }>();
  });

  it('EventSchema exposes connection + wire + monitor channels', () => {
    expectTypeOf<EventKind>().toEqualTypeOf<
      | 'connection-state'
      | 'wire-frame'
      | 'layout-snapshot'
      | 'variables-snapshot'
      | 'watchlist-snapshot'
      | 'screen-snapshot'
      | 'dynamic-profiles-snapshot'
      | 'registrations-snapshot'
      | 'custom-escape-snapshot'
    >();
  });

  it('keeps RpcSchema and EventSchema structurally distinct', () => {
    expectTypeOf<RpcSchema>().not.toEqualTypeOf<EventSchema>();
  });
});
