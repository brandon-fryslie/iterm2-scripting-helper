import { describe, it, expect, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  ServerOriginatedMessageSchema,
  NotificationType,
  NotificationResponse_Status,
  type ServerOriginatedMessage,
} from '@shared/proto/gen/api_pb';
import { ConnectionOrchestrator, notificationRefusal } from './ConnectionOrchestrator';
import { ConnectionStore } from '../stores/ConnectionStore';
import { LayoutStore } from '../stores/LayoutStore';
import { AppEventLog } from '../stores/AppEventLog';
import { VariableStore } from '../stores/VariableStore';
import { WatchlistStore } from '../stores/WatchlistStore';
import { ScreenStreamStore } from '../stores/ScreenStreamStore';
import { RegistrationStore } from '../stores/RegistrationStore';
import { CustomEscapeStore } from '../stores/CustomEscapeStore';
import type { RpcRegistrationSpec } from '@shared/rpc';

function notificationResponse(status: NotificationResponse_Status): ServerOriginatedMessage {
  return create(ServerOriginatedMessageSchema, {
    id: 1n,
    submessage: { case: 'notificationResponse', value: { status } },
  });
}

describe('notificationRefusal', () => {
  it('accepts an OK status as success', () => {
    expect(
      notificationRefusal(
        notificationResponse(NotificationResponse_Status.OK),
        NotificationType.NOTIFY_ON_KEYSTROKE,
        true,
      ),
    ).toBeNull();
  });

  it('names each refusal status rather than swallowing it as success', () => {
    const refusals: Array<[NotificationResponse_Status, string]> = [
      [NotificationResponse_Status.SESSION_NOT_FOUND, 'SESSION_NOT_FOUND'],
      [NotificationResponse_Status.REQUEST_MALFORMED, 'REQUEST_MALFORMED'],
      [NotificationResponse_Status.NOT_SUBSCRIBED, 'NOT_SUBSCRIBED'],
      [NotificationResponse_Status.ALREADY_SUBSCRIBED, 'ALREADY_SUBSCRIBED'],
      [NotificationResponse_Status.DUPLICATE_SERVER_ORIGINATED_RPC, 'DUPLICATE_SERVER_ORIGINATED_RPC'],
      [NotificationResponse_Status.INVALID_IDENTIFIER, 'INVALID_IDENTIFIER'],
    ];
    for (const [status, name] of refusals) {
      const message = notificationRefusal(
        notificationResponse(status),
        NotificationType.NOTIFY_ON_PROMPT,
        true,
      );
      expect(message).toContain(name);
      expect(message).toContain('NOTIFY_ON_PROMPT');
    }
  });

  it('surfaces a transport-level error submessage', () => {
    const response = create(ServerOriginatedMessageSchema, {
      id: 2n,
      submessage: { case: 'error', value: 'boom' },
    });
    expect(
      notificationRefusal(response, NotificationType.NOTIFY_ON_FOCUS_CHANGE, true),
    ).toContain('boom');
  });

  it('rejects a response that never carried a notificationResponse', () => {
    const response = create(ServerOriginatedMessageSchema, { id: 3n });
    const message = notificationRefusal(
      response,
      NotificationType.NOTIFY_ON_NEW_SESSION,
      true,
    );
    expect(message).toContain('unexpected response');
  });

  it('labels the verb by the subscribe flag so unsubscribe refusals read correctly', () => {
    const message = notificationRefusal(
      notificationResponse(NotificationResponse_Status.NOT_SUBSCRIBED),
      NotificationType.NOTIFY_ON_KEYSTROKE,
      false,
    );
    expect(message).toContain('unsubscribe(');
  });
});

function buildOrchestrator() {
  const appEvents = new AppEventLog();
  const monitor = {
    layout: new LayoutStore(),
    variables: new VariableStore(appEvents),
    watchlist: new WatchlistStore(),
    appEvents,
    screen: new ScreenStreamStore(),
    registrations: new RegistrationStore(),
    customEscape: new CustomEscapeStore(),
  };
  const store = new ConnectionStore();
  const orchestrator = new ConnectionOrchestrator(store, monitor, {
    advisoryName: 'test',
    libraryVersion: 'test',
  });
  return { orchestrator, monitor, store };
}

describe('disconnect establishes the disconnected state authoritatively', () => {
  it('lands the store at idle even when disconnected mid-handshake, before any socket opened', async () => {
    const { orchestrator, store } = buildOrchestrator();
    // The state a connect parks in while awaiting the cookie subprocess: no socket is open yet, so
    // protocol.disconnect() emits nothing. Disconnect must still resolve the store to a non-connected
    // state rather than leave it reporting a live-looking 'requesting-cookie' the user already dropped.
    store.setState('requesting-cookie');

    await orchestrator.disconnect();

    expect(store.state).toBe('idle');
  });
});

const RPC_SPEC: RpcRegistrationSpec = {
  id: 'reg-1',
  persistent: false,
  role: 'generic',
  name: 'doThing',
  arguments: [],
  defaults: [],
  timeout: 5,
  responseTemplate: '',
};

describe('registerRpc refusal handling', () => {
  it('rejects to the caller and records no registration when iTerm2 refuses the subscribe', async () => {
    const { orchestrator, monitor } = buildOrchestrator();
    const send = vi.fn(async () => ({
      message: notificationResponse(NotificationResponse_Status.DUPLICATE_SERVER_ORIGINATED_RPC),
      frameSeq: 0,
    }));
    (orchestrator as unknown as { protocol: { send: typeof send } }).protocol.send = send;

    await expect(orchestrator.registerRpc(RPC_SPEC)).rejects.toThrow(
      'DUPLICATE_SERVER_ORIGINATED_RPC',
    );
    expect(monitor.registrations.get('reg-1')).toBeNull();
  });

  it('resolves and records the registration when iTerm2 accepts the subscribe', async () => {
    const { orchestrator, monitor } = buildOrchestrator();
    const send = vi.fn(async () => ({
      message: notificationResponse(NotificationResponse_Status.OK),
      frameSeq: 0,
    }));
    (orchestrator as unknown as { protocol: { send: typeof send } }).protocol.send = send;

    await orchestrator.registerRpc(RPC_SPEC);
    expect(monitor.registrations.get('reg-1')?.id).toBe('reg-1');
  });
});
