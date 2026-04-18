import { ipcMain } from 'electron';
import type { RpcMethod, RpcArgs, RpcResult } from '@shared/rpc';

type Handlers = { [M in RpcMethod]: (args: RpcArgs<M>) => Promise<RpcResult<M>> };

const handlers: Handlers = {
  'system/ping': async () => ({
    ok: true,
    now: Date.now(),
    electron: process.versions.electron ?? 'unknown',
  }),
};

export function registerIpc(): void {
  ipcMain.handle('rpc', async (_event, payload: { method: RpcMethod; args: unknown }) => {
    const handler = handlers[payload.method] as (a: unknown) => Promise<unknown>;
    return handler(payload.args);
  });
}
