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
  it('includes system/ping and the connection/* family', () => {
    expectTypeOf<RpcMethod>().toEqualTypeOf<
      | 'system/ping'
      | 'connection/snapshot'
      | 'connection/connect'
      | 'connection/disconnect'
      | 'connection/list-sessions'
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

  it('EventSchema exposes connection-state and wire-frame', () => {
    expectTypeOf<EventKind>().toEqualTypeOf<'connection-state' | 'wire-frame'>();
  });

  it('keeps RpcSchema and EventSchema structurally distinct', () => {
    expectTypeOf<RpcSchema>().not.toEqualTypeOf<EventSchema>();
  });
});
