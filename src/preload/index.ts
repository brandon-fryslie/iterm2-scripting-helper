import { contextBridge, ipcRenderer } from 'electron';
import type { RpcMethod, RpcArgs, RpcResult } from '@shared/rpc';

contextBridge.exposeInMainWorld('ipc', {
  invoke: <M extends RpcMethod>(method: M, args: RpcArgs<M>): Promise<RpcResult<M>> =>
    ipcRenderer.invoke('rpc', { method, args }) as Promise<RpcResult<M>>,
});
