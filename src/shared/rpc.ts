export type RpcSchema = {
  'system/ping': { args: void; result: { ok: true; now: number; electron: string } };
};

export type RpcMethod = keyof RpcSchema;
export type RpcArgs<M extends RpcMethod> = RpcSchema[M]['args'];
export type RpcResult<M extends RpcMethod> = RpcSchema[M]['result'];

export type EventSchema = Record<string, never>;

export type EventKind = keyof EventSchema;
export type EventPayload<K extends EventKind> = EventSchema[K];
