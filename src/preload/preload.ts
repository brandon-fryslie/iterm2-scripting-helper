import { contextBridge, ipcRenderer } from 'electron';
import type {
  RpcMethod,
  RpcArgs,
  RpcResult,
  EventKind,
  EventPayload,
} from '@shared/rpc';

contextBridge.exposeInMainWorld('ipc', {
  invoke: <M extends RpcMethod>(method: M, args: RpcArgs<M>): Promise<RpcResult<M>> =>
    ipcRenderer.invoke('rpc', { method, args }) as Promise<RpcResult<M>>,

  on: <K extends EventKind>(
    kind: K,
    handler: (payload: EventPayload<K>) => void,
  ): (() => void) => {
    const channel = `event:${String(kind)}`;
    const listener = (_: unknown, payload: unknown): void => {
      handler(payload as EventPayload<K>);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
});
