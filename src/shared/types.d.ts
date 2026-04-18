import type { RpcMethod, RpcArgs, RpcResult } from './rpc';

declare global {
  interface Window {
    ipc: {
      invoke<M extends RpcMethod>(method: M, args: RpcArgs<M>): Promise<RpcResult<M>>;
    };
  }
}

export {};
