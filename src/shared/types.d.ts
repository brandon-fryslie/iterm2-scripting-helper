import type {
  RpcMethod,
  RpcArgs,
  RpcResult,
  EventKind,
  EventPayload,
} from './rpc';

declare global {
  interface Window {
    ipc: {
      invoke<M extends RpcMethod>(method: M, args: RpcArgs<M>): Promise<RpcResult<M>>;
      on<K extends EventKind>(
        kind: K,
        handler: (payload: EventPayload<K>) => void,
      ): () => void;
    };
  }
}

export {};
