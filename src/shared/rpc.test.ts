import { describe, it, expectTypeOf } from 'vitest';
import type { RpcSchema, RpcMethod, RpcArgs, RpcResult, EventSchema } from './rpc';

describe('RpcSchema', () => {
  it('exposes system/ping with the expected shape', () => {
    expectTypeOf<RpcMethod>().toEqualTypeOf<'system/ping'>();
    expectTypeOf<RpcArgs<'system/ping'>>().toEqualTypeOf<void>();
    expectTypeOf<RpcResult<'system/ping'>>().toEqualTypeOf<{
      ok: true;
      now: number;
      electron: string;
    }>();
  });

  it('keeps RpcSchema and EventSchema structurally distinct', () => {
    expectTypeOf<RpcSchema>().not.toEqualTypeOf<EventSchema>();
  });
});
