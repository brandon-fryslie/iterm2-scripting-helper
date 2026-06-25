import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { create, fromBinary } from '@bufbuild/protobuf';
import {
  ClientOriginatedMessageSchema,
  ServerOriginatedMessageSchema,
  ListSessionsRequestSchema,
  NotificationRequestSchema,
  VariableRequestSchema,
  GetBufferRequestSchema,
  GetPromptRequestSchema,
  GetPromptResponse_Status,
  LineRangeSchema,
  RPCRegistrationRequestSchema,
  RPCRegistrationRequest_RPCArgumentSignatureSchema,
  ServerOriginatedRPCResultRequestSchema,
  RegisterToolResponse_Status,
  InvokeFunctionRequestSchema,
  InvokeFunctionRequest_AppSchema,
  InvokeFunctionRequest_SessionSchema,
  InvokeFunctionRequest_TabSchema,
  InvokeFunctionRequest_WindowSchema,
  InvokeFunctionResponse_Status,
  NotificationType,
  NotificationResponse_Status,
  VariableScope,
  VariableResponse_Status,
  PromptMonitorMode,
  RPCRegistrationRequest_Role,
  type ServerOriginatedMessage,
  type Notification,
  type InvokeFunctionRequest,
} from '@shared/proto/gen/api_pb';
import {
  convertLayout,
  convertGetBuffer,
  convertPromptNotification,
  convertGetPrompt,
  classifyNotification,
  variableScopeName,
} from '@shared/converters';
import {
  buildFleetSessionRecord,
  collectFleetTargets,
  emptyFleetSnapshot,
  type FleetReadFailure,
  type FleetSessionRecord,
  type FleetTarget,
} from '@shared/fleetQuery';
import { AppleScriptDriver, AppleScriptError } from './AppleScriptDriver';
import { buildRegistrationRequest, buildToolRequest } from './registrationWire';
import {
  ProtocolDriver,
  ProtocolError,
  type WireFrame,
  type ProtocolNotification,
  type ProtocolClose,
} from './ProtocolDriver';
import { ReconnectController } from './ReconnectController';
import { CoalescingScheduler } from './CoalescingScheduler';
import { reconnectDelay } from '../reconnectPolicy';
import type { ConnectionStore } from '../stores/ConnectionStore';
import type { LayoutStore } from '../stores/LayoutStore';
import type { VariableStore } from '../stores/VariableStore';
import type { WatchlistStore } from '../stores/WatchlistStore';
import { AppEventLog } from '../stores/AppEventLog';
import type { ScreenStreamStore } from '../stores/ScreenStreamStore';
import type { PromptStore } from '../stores/PromptStore';
import type { FleetStore } from '../stores/FleetStore';
import type { RegistrationStore } from '../stores/RegistrationStore';
import type {
  RegistrationSpec,
  RpcRegistrationSpec,
  ToolbeltRegistrationSpec,
} from '@shared/rpc';
import type { CustomEscapeStore } from '../stores/CustomEscapeStore';
import {
  APP_ENTITY,
  type AppEntityRef,
  type AppProbeResult,
  type AppInvocationPayload,
  type AppPrompt,
} from '@shared/domain';
import {
  normalizeProbeTarget,
  describeVariableStatus,
  buildProbeEvalInvocation,
  PROBE_EVAL_FUNCTION,
  PROBE_EVAL_ARG,
} from '../probe';

export const DEFAULT_SOCKET_PATH = path.join(
  os.homedir(),
  'Library/Application Support/iTerm2/private/socket',
);

const SCREEN_COALESCE_MS = 16;

// A fleet capture sweeps every session (a variable dump + a prompt poll each), so it is far heavier than
// one screen refetch and is user-triggered, not a 60fps stream. A wider window collapses an impatient
// burst of Refresh clicks into a single bridge sweep without adding perceptible latency to one click.
const FLEET_COALESCE_MS = 150;

// Seconds iTerm2 waits for probe_eval to answer before failing the invocation. The handler echoes
// the already-interpolated value immediately, so this only bounds a stalled connection.
const PROBE_EVAL_TIMEOUT = 5;

export interface OrchestratorOptions {
  advisoryName: string;
  libraryVersion: string;
  socketPath?: string;
}

export interface MonitorStores {
  layout: LayoutStore;
  variables: VariableStore;
  watchlist: WatchlistStore;
  appEvents: AppEventLog;
  screen: ScreenStreamStore;
  prompt: PromptStore;
  fleet: FleetStore;
  registrations: RegistrationStore;
  customEscape: CustomEscapeStore;
}

export class ConnectionOrchestrator extends EventEmitter {
  private readonly applescript = new AppleScriptDriver();
  private readonly protocol = new ProtocolDriver();
  private readonly options: Required<OrchestratorOptions>;
  private credentials: { cookie: string; key: string } | null = null;
  private activeGlobalSubscriptions: NotificationType[] = [];
  private activeVariableSubs: Array<{ name: string; sessionId: string }> = [];
  private sessionScopedSubscriptions: Array<{
    type: NotificationType;
    sessionId: string;
  }> = [];
  // [LAW:no-ambient-temporal-coupling] Single owner of "when to refetch the screen". Screen-update
  // notifications arrive at up to 60fps; this collapses that burst into at most one buffer refetch per
  // SCREEN_COALESCE_MS window while guaranteeing the trailing frame is never dropped, so the screen pane
  // stays bounded under load yet converges to the latest state. The full-fidelity raw frames remain
  // available through the Wire pane, which records every frame on the spine independently of this.
  private readonly screenRefetch = new CoalescingScheduler(
    () => this.refetchFocusedScreen(),
    SCREEN_COALESCE_MS,
  );
  // [LAW:no-ambient-temporal-coupling] Single owner of "when to run the next fleet capture". A Refresh
  // click (or several) calls request(); this guarantees at most one capture in flight and a trailing one
  // if a request lands mid-sweep, so the fleet view converges to the latest state without N overlapping
  // bridge sweeps — the same discipline the screen refetch uses, applied to the whole-fleet read.
  private readonly fleetRefetch = new CoalescingScheduler(
    () => this.captureFleetSnapshot(),
    FLEET_COALESCE_MS,
  );
  // [LAW:no-ambient-temporal-coupling] Single owner of the probe_eval registration lifecycle: the
  // in-flight (or settled) registration promise for this connection. Template probes await it so the
  // function is registered exactly once before the first invoke; it is nulled on close so the next
  // connection re-registers, and on failure so a later probe retries.
  private probeRegistration: Promise<void> | null = null;
  // [LAW:no-ambient-temporal-coupling] The single owner of reconnect timing. The orchestrator owns the
  // connect sequence (cookie + protocol + subscriptions + re-register); this owns *when* to re-run it
  // after an unsolicited drop. Separating the two keeps the retry loop testable apart from osascript.
  private readonly reconnect = new ReconnectController(
    () => this.reconnectAttempt(),
    reconnectDelay,
  );
  // [LAW:no-ambient-temporal-coupling] The single owner of "which connect attempt is current". Every
  // connect lifecycle — manual connect, manual disconnect, and each auto-reconnect attempt — bumps it. A
  // connect sequence captures its epoch and abandons all further effects the moment a newer one
  // supersedes it, so a slow in-flight reconnect attempt can neither flip connection state out from
  // under a manual connect/disconnect nor resurrect a connection the user just dropped.
  private connectEpoch = 0;

  constructor(
    private readonly store: ConnectionStore,
    private readonly monitor: MonitorStores,
    options: OrchestratorOptions,
  ) {
    super();
    this.options = {
      socketPath: DEFAULT_SOCKET_PATH,
      ...options,
    };
    this.store.advisoryName = this.options.advisoryName;
    this.store.setSocket(this.options.socketPath, existsSync(this.options.socketPath));
    this.monitor.variables.setLiveNames(this.monitor.watchlist.names());

    this.protocol.on('frame', (frame: WireFrame) => {
      this.store.recordFrame();
      // [LAW:one-source-of-truth] The wire frame is one AppEvent in the spine, decoded once here at
      // the boundary; the wire pane is a projection of these, not a separate ring.
      const decoded = decodeWireFrame(frame.direction, frame.bytes);
      this.monitor.appEvents.append({
        kind: 'wire-frame',
        at: frame.at,
        frameSeq: frame.frameSeq,
        entity: APP_ENTITY,
        causedBy: null,
        payload: {
          direction: frame.direction,
          size: frame.bytes.byteLength,
          messageKind: decoded.messageKind,
          requestId: decoded.requestId,
        },
      });
      this.emit('frame', frame);
    });
    this.protocol.on('notification', ({ notification: n, frameSeq }: ProtocolNotification) => {
      const classified = classifyNotification(n);
      // [LAW:no-ambient-temporal-coupling] The notification carries the frameSeq of the frame it was
      // decoded from, so it joins to that wire frame (and any resulting variable change) by foreign
      // key, never by timestamp window or emit order.
      const notifEvent = this.monitor.appEvents.append({
        kind: 'notification',
        at: Date.now(),
        frameSeq,
        entity: notificationEntity(classified.sessionId),
        causedBy: null,
        payload: {
          kind: classified.kind,
          sessionId: classified.sessionId,
          summary: classified.summary,
          detail: classified.payload,
        },
      });
      // A server-originated RPC invocation (handled inside routeNotification) is the effect of THIS
      // notification, so it links back to it via causedBy — the spine's one honest seq-pointer
      // causal edge. The notification's seq travels as a value, not a timestamp guess.
      this.routeNotification(n, frameSeq, notifEvent.seq);
      this.emit('notification', { notification: n, frameSeq });
    });
    this.protocol.on('state', () =>
      this.store.syncFromProtocol(this.protocol.getState(), this.protocol.getProtocolVersion()),
    );
    this.protocol.on('close', ({ code, reason, requested }: ProtocolClose) => {
      this.monitor.layout.clear();
      // [LAW:single-enforcer] The same `requested` discriminant that owns "reconnect iff unsolicited"
      // owns "preserve focus iff unsolicited": an unsolicited drop keeps the focused-session intent so
      // the reconnect sequence re-establishes its session-scoped subscriptions, while a requested
      // disconnect fully resets it. The intent never outlives the user's decision to stay disconnected.
      if (requested) this.monitor.variables.clearAll();
      else this.monitor.variables.clearValuesPreservingFocus();
      this.monitor.appEvents.clear();
      this.monitor.screen.clear();
      this.monitor.prompt.clear();
      // Unlike the other monitor stores, registrations are not blanket-cleared: a close ends the
      // current connection era (so every registration reads dead) and forgets only the
      // connection-scoped specs. Persistent specs survive so connect() can re-register them.
      this.monitor.registrations.onConnectionClosed();
      this.monitor.customEscape.clearAll();
      this.probeRegistration = null;
      this.activeGlobalSubscriptions = [];
      this.activeVariableSubs = [];
      this.sessionScopedSubscriptions = [];
      this.screenRefetch.cancel();
      // The fleet snapshot referenced now-dead sessions; cancel any pending sweep and drop it so a query
      // can never match a session that died with the connection. [LAW:no-silent-failure]
      this.fleetRefetch.cancel();
      this.monitor.fleet.clear();
      this.emit('close', { code, reason });
      this.superviseAfterClose(requested);
    });
    this.protocol.on('error', (err) => {
      this.store.setError(errString(err));
      this.emit('error', err);
    });
  }

  // A user-initiated connect. It supersedes any auto-reconnect loop in flight (clicking Connect cancels
  // the backoff and connects now) and reports a failure as the terminal 'error' state — the user asked,
  // so the user is told. The reconnect path runs the same sequence but keeps trying on failure.
  // [LAW:decomposition] The reconnect policy, kept separate from close teardown: an unsolicited drop
  // (iTerm2 quit/restarted) hands the reconnect lifecycle to its supervisor and surfaces the transient
  // 'reconnecting' state so the renderer shows recovery without user action; a requested disconnect
  // (user, or app quit) stays down. `requested` is the represented close discriminant, never inferred
  // from timing — the one place the "reconnect iff unsolicited" policy lives. [LAW:single-enforcer]
  private superviseAfterClose(requested: boolean): void {
    if (requested) return;
    // [LAW:no-ambient-temporal-coupling] Reconnect supervision is taking over; invalidate any in-flight
    // manual connect so its eventual failure cannot overwrite this 'reconnecting' state with a terminal
    // 'error' the user can no longer act on.
    this.connectEpoch += 1;
    this.store.setState('reconnecting');
    this.reconnect.start();
  }

  async connect(): Promise<void> {
    // [LAW:no-ambient-temporal-coupling] Mark all prior attempts stale before releasing the scheduler,
    // so supersession is the unconditional first action of an override and never depends on no await
    // sitting between these two statements.
    const epoch = ++this.connectEpoch;
    this.reconnect.cancel();
    try {
      await this.runConnectSequence(epoch);
    } catch (err) {
      // Only the current attempt owns the terminal error state; a manual connect/disconnect that
      // superseded this one mid-flight has already set the authoritative state. [LAW:no-silent-failure]
      // the failure still propagates to the caller — it is not swallowed, only the stale store write is.
      if (epoch === this.connectEpoch) this.store.setError(errString(err));
      throw err;
    }
  }

  // One unsolicited-drop recovery attempt, run by the reconnect supervisor. [LAW:no-silent-failure] A
  // failed attempt records its reason on the snapshot and stays in 'reconnecting' (the supervisor will
  // re-arm), rather than surfacing a terminal error; it rethrows so the controller schedules the next
  // attempt with the next backoff.
  private async reconnectAttempt(): Promise<void> {
    const epoch = ++this.connectEpoch;
    try {
      await this.runConnectSequence(epoch);
    } catch (err) {
      // [LAW:no-ambient-temporal-coupling] A superseded attempt must not flip state back to
      // 'reconnecting' after a manual connect/disconnect has taken over; only the current attempt records
      // its failure. The rethrow is unconditional so the controller's own active check decides re-arm.
      if (epoch === this.connectEpoch) this.store.noteReconnectFailure(errString(err));
      throw err;
    }
  }

  // [LAW:single-enforcer] The one connect sequence both an initial/manual connect and a reconnect
  // attempt run — detect the socket, request a fresh cookie, open the protocol, then restore layout,
  // global subscriptions, and persistent registrations. Sharing it is what makes a reconnect a true
  // re-handshake (a fresh cookie every time), not a half-restore. Error policy is the caller's: connect()
  // makes a failure terminal, reconnectAttempt() keeps it transient.
  private async runConnectSequence(epoch: number): Promise<void> {
    // [LAW:no-ambient-temporal-coupling] Begin from a guaranteed-disconnected protocol. A manual Connect
    // can land while a reconnect attempt still holds an open socket; tearing it down here lets this
    // sequence take over immediately instead of racing ProtocolDriver.connect() in 'ready' state. It is a
    // true no-op when already disconnected (ProtocolDriver.disconnect emits nothing in that branch), so
    // reconnect attempts — which the controller already serializes one at a time — are unaffected.
    await this.protocol.disconnect();
    // A superseding connect/disconnect may have taken over during the teardown await; bail before any
    // store write so a stale attempt cannot flip state back to 'detecting' after the user took over.
    this.assertCurrent(epoch, 'after disconnect');
    this.store.setState('detecting');
    const exists = existsSync(this.options.socketPath);
    this.store.setSocket(this.options.socketPath, exists);
    if (!exists) {
      throw new ProtocolError(
        `iTerm2 private socket not found at ${this.options.socketPath}. Is iTerm2 running?`,
      );
    }

    this.store.setState('requesting-cookie');
    this.store.noteCookieRequested();
    const credentials = await this.applescript.requestCookieAndKey(
      this.options.advisoryName,
    );
    // [LAW:no-ambient-temporal-coupling] Requesting the cookie is the long await where a manual
    // connect/disconnect can supersede this attempt. If one did, bail before opening the protocol — a
    // stale attempt must never resurrect a connection the user just dropped or steal a manual connect.
    this.assertCurrent(epoch, 'before handshake');
    this.credentials = credentials;

    this.store.setState('connecting');
    await this.protocol.connect({
      socketPath: this.options.socketPath,
      advisoryName: this.options.advisoryName,
      libraryVersion: this.options.libraryVersion,
      cookie: this.credentials.cookie,
      key: this.credentials.key,
    });

    // [LAW:no-ambient-temporal-coupling] The single post-open cleanup path. Once the ws is open, this
    // sequence must either reach a fully-ready connection or leave the protocol disconnected — never a
    // live ws under a thrown sequence, which would poison the next connect with "connect called in state
    // ready" and stick the reconnect loop. So every exit after the handshake — a supersession caught by
    // assertCurrent, or a refreshLayout/subscription failure — routes through this catch, which tears the
    // protocol back down before rethrowing.
    try {
      this.assertCurrent(epoch, 'after handshake');
      // Fetch then check then apply: a stale attempt must not apply a layout after a newer connect took
      // over, so the epoch is re-checked between the fetch (an await) and the apply (the effect).
      const layout = await this.fetchLayout();
      this.assertCurrent(epoch, 'after layout');
      if (layout) this.monitor.layout.apply(layout);
      await this.subscribeGlobalNotifications();
      this.assertCurrent(epoch, 'after subscriptions');
      await this.reregisterPersistent();
      this.assertCurrent(epoch, 'after re-registration');
      await this.restoreFocusedSession(epoch);
      // [LAW:no-ambient-temporal-coupling] Publish 'ready' only after a fully-current restore. Until
      // here the store stays 'connecting', so a superseded attempt never publishes a ready connection the
      // user didn't ask for, and any layout it applied is not yet visible as a ready connection.
      this.assertCurrent(epoch, 'after focus restore');
      this.store.syncFromProtocol(this.protocol.getState(), this.protocol.getProtocolVersion());
    } catch (err) {
      // [LAW:no-ambient-temporal-coupling] Only tear down if this attempt still owns the protocol. If a
      // newer connect has superseded it — and may have already reopened the socket — disconnecting here
      // would destroy that fresh connection; the new owner is responsible for the protocol. Nothing
      // leaks, because the superseding op begins with its own disconnect-first, which reclaims this
      // attempt's socket.
      if (epoch === this.connectEpoch) {
        await this.protocol.disconnect().catch(() => void 0);
      }
      throw err;
    }
  }

  // [LAW:no-ambient-temporal-coupling] Throws if a newer connect lifecycle has superseded the one that
  // captured `epoch`, so a stale in-flight attempt stops driving side effects at the next checkpoint.
  private assertCurrent(epoch: number, phase: string): void {
    if (epoch !== this.connectEpoch) {
      throw new ProtocolError(`connect attempt superseded ${phase}`);
    }
  }

  async disconnect(): Promise<void> {
    // A user disconnect supersedes any reconnect loop: bump the epoch first so an attempt already in
    // flight bails at its next staleness check instead of resurrecting the connection the user just
    // asked to drop, then stop retrying. [LAW:no-ambient-temporal-coupling] supersession before release.
    this.connectEpoch += 1;
    this.reconnect.cancel();
    this.screenRefetch.cancel();
    this.fleetRefetch.cancel();
    await this.protocol.disconnect();
    this.credentials = null;
    // [LAW:one-source-of-truth] Disconnect is the single owner of establishing the disconnected state,
    // so it sets 'idle' unconditionally rather than relying on protocol.disconnect()'s emit — which only
    // fires when a socket was actually open. A disconnect mid-handshake (the connect parked in
    // 'requesting-cookie' awaiting the cookie) opened no socket, so without this the store would keep
    // misreporting a live-looking connection the user already dropped. The epoch bump above already
    // doomed the superseded attempt's own writes, so this idle is the final authoritative word.
    this.store.setState('idle');
  }

  async sendRequest(
    msg: Parameters<ProtocolDriver['send']>[0],
  ): Promise<ServerOriginatedMessage> {
    const started = Date.now();
    // External callers (actions, workbench, ipc) want only the decoded message; the frame identity
    // is internal provenance used by the variable dump path, so it is unwrapped here.
    const { message } = await this.protocol.send(msg);
    this.store.setLatency(Date.now() - started);
    return message;
  }

  async setFocusedSession(sessionId: string | null): Promise<void> {
    const prevSession = this.monitor.variables.focusedSessionId;
    if (prevSession === sessionId) return;

    await this.tearDownSessionSubscriptions(prevSession);
    this.monitor.variables.setFocused(sessionId);
    this.monitor.screen.setFocused(sessionId);
    // [LAW:single-enforcer] Prompt structure is focused-session-scoped exactly like the screen mirror, so
    // it resets on the same focus transition and through the same owner — never on a separate cadence.
    this.monitor.prompt.setFocused(sessionId);

    if (!sessionId || this.protocol.getState() !== 'ready') return;

    try {
      const { dict, frameSeq } = await this.fetchAllVariablesForSession(sessionId);
      this.monitor.variables.applyDump(sessionVariableEntity(sessionId), dict, frameSeq);
    } catch (err) {
      this.emit('error', err);
    }

    await this.reconcileWatchSubscriptions(sessionId);

    await this.subscribeSessionScoped(sessionId);
    await this.fetchScreenBuffer(sessionId).catch(() => void 0);
  }

  // [LAW:single-enforcer] The focused session's session-scoped subscriptions (keystroke, prompt,
  // screen-update) and its screen buffer are connection-scoped state, like persistent registrations: a
  // reconnect must re-establish them or those streams stay dead until the user re-focuses. This re-runs
  // the establish half of setFocusedSession for the focus that survived an unsolicited close (there is
  // nothing to tear down — the close already cleared the old wire subscriptions). It runs inside
  // runConnectSequence before 'ready', so every await is epoch-guarded (fetch -> assertCurrent ->
  // apply): a superseded attempt applies nothing, exactly as the rest of the sequence does. A genuine
  // fetch failure is non-fatal and represented (emit 'error' / noteFetchFailed), never swallowed.
  private async restoreFocusedSession(epoch: number): Promise<void> {
    const sessionId = this.monitor.variables.focusedSessionId;
    if (!sessionId) return;
    // [LAW:no-ambient-temporal-coupling] The method takes `epoch` to be self-guarding: assert before the
    // first store mutation so a future await inserted ahead of this call cannot let a superseded attempt
    // clobber the focused-screen state. Every effect in the connect sequence is epoch-guarded; this is no
    // exception, even though the sole caller asserts immediately before with no await in between today.
    this.assertCurrent(epoch, 'before focus restore');
    this.monitor.screen.setFocused(sessionId);
    this.monitor.prompt.setFocused(sessionId);

    const dump = await this.fetchAllVariablesForSession(sessionId).catch((err) => {
      // [LAW:no-silent-failure] A genuine dump failure on the current connection is surfaced; but a
      // rejection caused by a newer attempt tearing this protocol down is not a failure to report — the
      // assertCurrent below turns that into the supersession it actually is.
      if (epoch === this.connectEpoch) this.emit('error', err);
      return null;
    });
    this.assertCurrent(epoch, 'after focus var dump');
    if (dump) this.monitor.variables.applyDump(sessionVariableEntity(sessionId), dump.dict, dump.frameSeq);

    await this.reconcileWatchSubscriptions(sessionId);
    this.assertCurrent(epoch, 'after focus watch reconcile');
    await this.subscribeSessionScoped(sessionId);
    this.assertCurrent(epoch, 'after focus resubscribe');
    // [LAW:no-ambient-temporal-coupling] fetchScreenBuffer fuses the send and the apply, so the epoch is
    // threaded in as the staleness check it runs between them: a buffer fetched in a window this attempt
    // was superseded in is not applied. The outer assertCurrent('after focus restore') still tears down.
    await this.fetchScreenBuffer(sessionId, false, () => epoch === this.connectEpoch);
  }

  async setFocusedVariables(entity: AppEntityRef): Promise<void> {
    this.monitor.variables.setFocusedEntity(entity);
    if (this.protocol.getState() !== 'ready') return;

    try {
      const { dict, frameSeq } = await this.fetchAllVariablesForEntity(entity);
      this.monitor.variables.applyDump(entity, dict, frameSeq);
    } catch (err) {
      this.emit('error', err);
    }
  }

  // [LAW:effects-at-boundaries] The renderer's Fleet lens calls this to (re)capture the whole fleet. It only
  // SCHEDULES the capture through the coalescing window — the sweep runs in captureFleetSnapshot and the
  // result rides the 'fleet-snapshot' broadcast — so an impatient burst of Refresh clicks collapses to one
  // bridge sweep. Safe to call unconditionally; the scheduler enforces the bound.
  refreshFleet(): void {
    this.fleetRefetch.request();
  }

  // The one IO boundary of the Fleet Query Console: read every live session's variables + last prompt and
  // assemble a FleetSnapshot. A session that cannot be read is NEVER dropped — it lands in `failures` with
  // its reason ([LAW:no-silent-failure]), so a query over a partial fleet is labeled partial, not quietly
  // short. Reads run concurrently and are gathered with allSettled, so one unreadable session cannot abort
  // the whole sweep.
  private async captureFleetSnapshot(): Promise<void> {
    if (this.protocol.getState() !== 'ready') {
      this.monitor.fleet.apply(emptyFleetSnapshot(Date.now()));
      return;
    }
    const targets = collectFleetTargets(this.monitor.layout.windows);
    const settled = await Promise.allSettled(
      targets.map((target) => this.fetchFleetSessionRecord(target)),
    );
    const sessions: FleetSessionRecord[] = [];
    const failures: FleetReadFailure[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') sessions.push(result.value);
      else failures.push({ ref: targets[index].ref, reason: errString(result.reason) });
    });
    this.monitor.fleet.apply({ sessions, failures, capturedAt: Date.now() });
  }

  private async fetchFleetSessionRecord(target: FleetTarget): Promise<FleetSessionRecord> {
    const [dump, lastPrompt] = await Promise.all([
      this.fetchFleetSessionVariables(target.ref.sessionId),
      this.fetchLastPrompt(target.ref.sessionId),
    ]);
    return buildFleetSessionRecord(target, dump, lastPrompt);
  }

  // [LAW:no-silent-failure] Unlike fetchAllVariablesForEntity (which folds an error into an empty dict for
  // the focused-pane display), the fleet read must distinguish "read failed" from "no variables": an error
  // or unexpected response THROWS so the session lands in `failures`, never silently matching nothing.
  private async fetchFleetSessionVariables(sessionId: string): Promise<Record<string, unknown>> {
    const req = create(VariableRequestSchema, {
      scope: variableRequestScope(sessionVariableEntity(sessionId)),
      get: ['*'],
    });
    const { message } = await this.protocol.send({
      submessage: { case: 'variableRequest' as const, value: req },
    });
    if (message.submessage.case === 'error') throw new Error(message.submessage.value);
    if (message.submessage.case !== 'variableResponse') {
      throw new Error(`unexpected response: ${message.submessage.case ?? '<none>'}`);
    }
    const values = message.submessage.value.values;
    if (values.length === 0) return {};
    return JSON.parse(values[0]) as Record<string, unknown>;
  }

  // Poll one session's last OSC-133 prompt. A clean non-OK status (PROMPT_UNAVAILABLE / SESSION_NOT_FOUND)
  // is the session legitimately having no marks → null (a valid record with no exit code), NOT a failure.
  // A transport error or unexpected case THROWS, surfacing the session as unreadable. [LAW:no-silent-failure]
  private async fetchLastPrompt(sessionId: string): Promise<AppPrompt | null> {
    const req = create(GetPromptRequestSchema, { session: sessionId });
    const { message } = await this.protocol.send({
      submessage: { case: 'getPromptRequest' as const, value: req },
    });
    if (message.submessage.case === 'error') throw new Error(message.submessage.value);
    if (message.submessage.case !== 'getPromptResponse') {
      throw new Error(`unexpected response: ${message.submessage.case ?? '<none>'}`);
    }
    const response = message.submessage.value;
    if (response.status !== GetPromptResponse_Status.OK) return null;
    return convertGetPrompt(response);
  }

  // [LAW:composability] Resolve one variable path against any entity scope and return a
  // self-describing result. Sibling of fetchAllVariablesForEntity (get:['*']); both flow through the
  // single variableRequestScope enforcer. The result IS the error surface — there is no fire-and-
  // forget path here, so a bad scope or path comes back as an `error` outcome the caller renders in
  // context, not an emit('error') the user has to correlate. [LAW:no-silent-failure]
  async probeVariable(entity: AppEntityRef, expression: string): Promise<AppProbeResult> {
    const target = normalizeProbeTarget(expression);
    if (target.kind === 'reject') {
      return { outcome: 'error', entity, expression, message: target.reject };
    }
    if (this.protocol.getState() !== 'ready') {
      return { outcome: 'error', entity, expression, message: 'Not connected to iTerm2.' };
    }
    // [LAW:dataflow-not-control-flow] Dispatch on the target's shape, decided once in the pure
    // normalizer: a single path resolves exactly; a template round-trips through probe_eval.
    return target.kind === 'path'
      ? this.probeVariablePath(entity, expression, target.path)
      : this.probeInterpolatedTemplate(entity, expression, target.template);
  }

  private async probeVariablePath(
    entity: AppEntityRef,
    expression: string,
    path: string,
  ): Promise<AppProbeResult> {
    const req = create(VariableRequestSchema, {
      scope: variableRequestScope(entity),
      get: [path],
    });
    try {
      const { message: response } = await this.protocol.send({
        submessage: { case: 'variableRequest' as const, value: req },
      });
      if (response.submessage.case === 'error') {
        return { outcome: 'error', entity, expression, message: response.submessage.value };
      }
      if (response.submessage.case !== 'variableResponse') {
        return {
          outcome: 'error',
          entity,
          expression,
          message: `Unexpected response: ${response.submessage.case ?? '<none>'}`,
        };
      }
      const variableResponse = response.submessage.value;
      if (variableResponse.status !== VariableResponse_Status.OK) {
        return {
          outcome: 'error',
          entity,
          expression,
          message: describeVariableStatus(variableResponse.status),
        };
      }
      // iTerm2 encodes an unset variable as the JSON string "null"; surface it verbatim.
      return { outcome: 'value', entity, expression, value: variableResponse.values[0] ?? 'null' };
    } catch (err) {
      return { outcome: 'error', entity, expression, message: errString(err) };
    }
  }

  // Evaluate a full interpolated template through the registered probe_eval round-trip: iTerm2 has
  // no interpolated-string eval message, so we invoke probe_eval passing the template as an
  // interpolated argument. iTerm2 interpolates it against the focused scope, calls our handler with
  // the evaluated value (handleServerRpc echoes it back), and that value returns here as the
  // invocation's jsonResult. [LAW:no-ambient-temporal-coupling] The nested server RPC resolves while
  // this invoke is pending — they correlate by message identity, never by ordering or timing.
  private async probeInterpolatedTemplate(
    entity: AppEntityRef,
    expression: string,
    template: string,
  ): Promise<AppProbeResult> {
    try {
      await this.ensureProbeFunctionRegistered();
    } catch (err) {
      return {
        outcome: 'error',
        entity,
        expression,
        message: `Could not register the probe function: ${errString(err)}`,
      };
    }
    const req = create(InvokeFunctionRequestSchema, {
      invocation: buildProbeEvalInvocation(template),
      context: invokeFunctionContext(entity),
      timeout: PROBE_EVAL_TIMEOUT,
    });
    try {
      const { message: response } = await this.protocol.send({
        submessage: { case: 'invokeFunctionRequest' as const, value: req },
      });
      if (response.submessage.case === 'error') {
        return { outcome: 'error', entity, expression, message: response.submessage.value };
      }
      if (response.submessage.case !== 'invokeFunctionResponse') {
        return {
          outcome: 'error',
          entity,
          expression,
          message: `Unexpected response: ${response.submessage.case ?? '<none>'}`,
        };
      }
      const disposition = response.submessage.value.disposition;
      if (disposition.case === 'error') {
        // [LAW:no-silent-failure] An invalid template (bad path, malformed call, wrong scope) comes
        // back as a named iTerm2 error reason, surfaced verbatim so the user can fix the expression.
        return {
          outcome: 'error',
          entity,
          expression,
          message:
            disposition.value.errorReason ||
            `Invocation failed (${InvokeFunctionResponse_Status[disposition.value.status]}).`,
        };
      }
      if (disposition.case !== 'success') {
        return {
          outcome: 'error',
          entity,
          expression,
          message: `Unexpected invocation disposition: ${disposition.case ?? '<none>'}`,
        };
      }
      // The evaluated template is the JSON-encoded value probe_eval received and echoed; surface it
      // verbatim, the same shape probeVariablePath returns for a single path.
      return { outcome: 'value', entity, expression, value: disposition.value.jsonResult };
    } catch (err) {
      return { outcome: 'error', entity, expression, message: errString(err) };
    }
  }

  // [LAW:no-ambient-temporal-coupling] Register the probe_eval passthrough exactly once per
  // connection. The cached promise is the single owner of that lifecycle: concurrent template probes
  // share one in-flight registration; a failure nulls it so a later probe retries; close() nulls it
  // so the next connection re-registers. This is NOT a user registration, so it never enters
  // RegistrationStore or the invocation spine. [LAW:decomposition]
  private ensureProbeFunctionRegistered(): Promise<void> {
    if (!this.probeRegistration) {
      this.probeRegistration = this.registerProbeFunction().catch((err) => {
        this.probeRegistration = null;
        throw err;
      });
    }
    return this.probeRegistration;
  }

  private async registerProbeFunction(): Promise<void> {
    const req = create(RPCRegistrationRequestSchema, {
      name: PROBE_EVAL_FUNCTION,
      arguments: [
        create(RPCRegistrationRequest_RPCArgumentSignatureSchema, { name: PROBE_EVAL_ARG }),
      ],
      timeout: PROBE_EVAL_TIMEOUT,
      role: RPCRegistrationRequest_Role.GENERIC,
    });
    await this.sendNotificationRequestRaw(
      NotificationType.NOTIFY_ON_SERVER_ORIGINATED_RPC,
      '',
      true,
      { arguments: { case: 'rpcRegistrationRequest', value: req } },
    );
  }

  async setWatched(name: string, watched: boolean): Promise<void> {
    this.monitor.watchlist.setWatched(name, watched);
    // [LAW:one-source-of-truth] The watchlist is the authority for which paths are live; both the
    // derived `live` flag and the live subscriptions flow from it, so they cannot drift.
    this.monitor.variables.setLiveNames(this.monitor.watchlist.names());
    await this.reconcileWatchSubscriptions(this.monitor.variables.focusedSessionId);
  }

  getSocketPath(): string {
    return this.options.socketPath;
  }

  // [LAW:single-enforcer] The one dispatch on the registration union. Both callers that turn a spec
  // into a wire registration — the IPC boundary (a renderer Install) and the reconnect path
  // (re-establishing persistent specs) — route through here, so the role→wire-family mapping lives
  // in exactly one place. The narrowed methods below stay closed; this is the only narrowing site.
  async register(spec: RegistrationSpec): Promise<void> {
    if (spec.role === 'toolbelt') await this.registerTool(spec);
    else await this.registerRpc(spec);
  }

  // [LAW:dataflow-not-control-flow] Re-establish every persistent registration unconditionally on a
  // reconnect; each one's outcome becomes a value in its live/dead status rather than a branch that
  // skips work. [LAW:no-silent-failure] A registration that fails to come back stays dead AND carries
  // its error in the snapshot — the failure is represented, never swallowed — and one bad
  // registration neither blocks the others nor sinks the connection.
  private async reregisterPersistent(): Promise<void> {
    for (const spec of this.monitor.registrations.persistentSpecs()) {
      try {
        await this.register(spec);
      } catch (err) {
        this.monitor.registrations.noteReregisterError(spec.id, errString(err));
      }
    }
  }

  // [LAW:decomposition] RPC registrations and toolbelt tools are different wire protocols, so each
  // gets its own closed method; the one dispatch on the spec union lives in register() above. The
  // narrowed parameter types make cross-routing (a toolbelt spec into the RPC subscription, or vice
  // versa) a compile error.
  async registerRpc(spec: RpcRegistrationSpec): Promise<void> {
    const req = buildRegistrationRequest(spec);
    await this.sendNotificationRequestRaw(
      NotificationType.NOTIFY_ON_SERVER_ORIGINATED_RPC,
      '',
      true,
      { arguments: { case: 'rpcRegistrationRequest', value: req } },
    );
    this.monitor.registrations.upsert(spec);
  }

  async registerTool(spec: ToolbeltRegistrationSpec): Promise<void> {
    const { message } = await this.protocol.send({
      submessage: {
        case: 'registerToolRequest',
        value: buildToolRequest(spec.attrs),
      },
    });
    if (message.submessage.case !== 'registerToolResponse') {
      throw new Error(
        `RegisterTool: unexpected response ${message.submessage.case ?? '(empty)'}`,
      );
    }
    const status = message.submessage.value.status;
    if (status !== RegisterToolResponse_Status.OK) {
      // [LAW:no-silent-failure] iTerm2 refused the tool; surface its named status, never a
      // locally-listed tool the server doesn't have.
      throw new Error(`RegisterTool failed: ${RegisterToolResponse_Status[status]}`);
    }
    this.monitor.registrations.upsert(spec);
  }

  async unregisterRpc(spec: RpcRegistrationSpec): Promise<void> {
    const req = buildRegistrationRequest(spec);
    await this.sendNotificationRequestRaw(
      NotificationType.NOTIFY_ON_SERVER_ORIGINATED_RPC,
      '',
      false,
      { arguments: { case: 'rpcRegistrationRequest', value: req } },
    ).catch(() => void 0);
    this.monitor.registrations.remove(spec.id);
  }

  // [LAW:no-ambient-temporal-coupling] Single owner of the custom-escape wire lifecycle. The
  // identity filter is local (the wire request carries none), so iTerm2 holds at most one
  // subscription per session and the local subscription set multiplexes over it: the wire sub
  // goes up with the first local sub for a session and down with the last. Without this,
  // a second subscribe returns ALREADY_SUBSCRIBED (silently) and the first unsubscribe kills
  // notifications for every remaining local sub on that session.
  async subscribeCustomEscape(
    subscriptionId: string,
    sessionId: string,
    identity: string,
  ): Promise<void> {
    const wireIsUp = this.monitor.customEscape
      .snapshot()
      .subscriptions.some((s) => s.sessionId === sessionId);
    if (!wireIsUp) {
      await this.sendNotificationRequest(
        NotificationType.NOTIFY_ON_CUSTOM_ESCAPE_SEQUENCE,
        sessionId,
        true,
      );
    }
    this.monitor.customEscape.addSubscription({
      id: subscriptionId,
      sessionId,
      identity,
      createdAt: Date.now(),
    });
  }

  async unsubscribeCustomEscape(subscriptionId: string): Promise<void> {
    const snap = this.monitor.customEscape.snapshot();
    const sub = snap.subscriptions.find((s) => s.id === subscriptionId);
    if (!sub) return;
    this.monitor.customEscape.removeSubscription(subscriptionId);
    const wireStillNeeded = this.monitor.customEscape
      .snapshot()
      .subscriptions.some((s) => s.sessionId === sub.sessionId);
    if (!wireStillNeeded) {
      await this.sendNotificationRequest(
        NotificationType.NOTIFY_ON_CUSTOM_ESCAPE_SEQUENCE,
        sub.sessionId,
        false,
      ).catch(() => void 0);
    }
  }

  async respondToServerRpc(
    requestId: string,
    jsonValue: string,
  ): Promise<void> {
    const req = create(ServerOriginatedRPCResultRequestSchema, {
      requestId,
      result: { case: 'jsonValue', value: jsonValue },
    });
    await this.protocol
      .send({ submessage: { case: 'serverOriginatedRpcResultRequest', value: req } })
      .catch((err) => this.emit('error', err));
  }

  async respondToServerRpcException(
    requestId: string,
    reason: string,
  ): Promise<void> {
    const req = create(ServerOriginatedRPCResultRequestSchema, {
      requestId,
      result: {
        case: 'jsonException',
        value: JSON.stringify({ reason }),
      },
    });
    await this.protocol
      .send({ submessage: { case: 'serverOriginatedRpcResultRequest', value: req } })
      .catch((err) => this.emit('error', err));
  }

  async refreshLayout(): Promise<void> {
    const layout = await this.fetchLayout();
    if (layout) this.monitor.layout.apply(layout);
  }

  // [LAW:effects-at-boundaries] Fetch the layout without applying it, so the connect sequence can insert
  // an epoch check between the fetch (an await) and the apply (the effect). The public refreshLayout
  // applies immediately; the reconnect path applies only if still current.
  private async fetchLayout(): Promise<ReturnType<typeof convertLayout> | null> {
    if (this.protocol.getState() !== 'ready') return null;

    const { message: response } = await this.protocol.send({
      submessage: {
        case: 'listSessionsRequest' as const,
        value: create(ListSessionsRequestSchema, {}),
      },
    });
    if (response.submessage.case === 'listSessionsResponse') {
      return convertLayout(response.submessage.value);
    }
    if (response.submessage.case === 'error') {
      throw new ProtocolError(response.submessage.value);
    }
    return null;
  }

  private async subscribeGlobalNotifications(): Promise<void> {
    const types: NotificationType[] = [
      NotificationType.NOTIFY_ON_LAYOUT_CHANGE,
      NotificationType.NOTIFY_ON_NEW_SESSION,
      NotificationType.NOTIFY_ON_TERMINATE_SESSION,
      NotificationType.NOTIFY_ON_FOCUS_CHANGE,
      NotificationType.NOTIFY_ON_BROADCAST_CHANGE,
    ];
    for (const t of types) {
      await this.sendNotificationRequest(t, 'all', true).catch((err) => {
        this.emit('error', err);
      });
      this.activeGlobalSubscriptions.push(t);
    }
  }

  private async subscribeSessionScoped(sessionId: string): Promise<void> {
    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_KEYSTROKE,
      sessionId,
      true,
      {
        arguments: {
          case: 'keystrokeMonitorRequest',
          value: {
            patternsToIgnore: [],
            advanced: false,
          },
        },
      },
    ).catch((err) => this.emit('error', err));
    this.sessionScopedSubscriptions.push({
      type: NotificationType.NOTIFY_ON_KEYSTROKE,
      sessionId,
    });

    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_PROMPT,
      sessionId,
      true,
      {
        arguments: {
          case: 'promptMonitorRequest',
          value: {
            modes: [
              PromptMonitorMode.PROMPT,
              PromptMonitorMode.COMMAND_START,
              PromptMonitorMode.COMMAND_END,
            ],
          },
        },
      },
    ).catch((err) => this.emit('error', err));
    this.sessionScopedSubscriptions.push({
      type: NotificationType.NOTIFY_ON_PROMPT,
      sessionId,
    });

    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_SCREEN_UPDATE,
      sessionId,
      true,
    ).catch((err) => this.emit('error', err));
    this.sessionScopedSubscriptions.push({
      type: NotificationType.NOTIFY_ON_SCREEN_UPDATE,
      sessionId,
    });
  }

  private async tearDownSessionSubscriptions(prevSession: string | null): Promise<void> {
    if (this.protocol.getState() === 'ready') {
      for (const sub of this.activeVariableSubs) {
        await this.toggleVariableSubscription(sub.sessionId, sub.name, false).catch(
          () => void 0,
        );
      }
      for (const sub of this.sessionScopedSubscriptions) {
        await this.sendNotificationRequest(sub.type, sub.sessionId, false).catch(
          () => void 0,
        );
      }
    }
    this.activeVariableSubs = [];
    this.sessionScopedSubscriptions = [];
    this.screenRefetch.cancel();
  }

  private async sendNotificationRequest(
    type: NotificationType,
    session: string,
    subscribe: boolean,
    args?: Parameters<typeof create<typeof NotificationRequestSchema>>[1],
  ): Promise<void> {
    await this.sendNotificationRequestRaw(type, session, subscribe, args);
  }

  private async sendNotificationRequestRaw(
    type: NotificationType,
    session: string,
    subscribe: boolean,
    args?: Parameters<typeof create<typeof NotificationRequestSchema>>[1],
  ): Promise<void> {
    const req = create(NotificationRequestSchema, {
      session,
      subscribe,
      notificationType: type,
      ...(args ?? {}),
    });
    const { message: response } = await this.protocol.send({
      submessage: { case: 'notificationRequest' as const, value: req },
    });
    // [LAW:effects-at-boundaries] The send is the effect; the verdict is a pure classification, thrown
    // here at the boundary. [LAW:single-enforcer] This is the one place every monitor/registration
    // (un)subscribe — global, session-scoped, variable watch, RPC registration, custom escape — learns
    // whether iTerm2 accepted it, so the refusal check lives here and nowhere else.
    const refusal = notificationRefusal(response, type, subscribe);
    if (refusal !== null) throw new ProtocolError(refusal);
  }

  // [LAW:no-ambient-temporal-coupling] Single owner of variable-subscription lifecycle. Idempotent:
  // diffs the watchlist (desired) against active subs for this session and applies the delta, so it
  // is safe to call on focus change and on every watchlist mutation regardless of ordering.
  private async reconcileWatchSubscriptions(sessionId: string | null): Promise<void> {
    if (!sessionId || this.protocol.getState() !== 'ready') return;
    const desired = new Set(this.monitor.watchlist.names());
    const sessionSubs = this.activeVariableSubs.filter((s) => s.sessionId === sessionId);
    // [LAW:one-source-of-truth] `active` tracks only confirmed-live subscriptions and is updated
    // solely from toggle outcomes, so a failed subscribe stays absent and is retried next reconcile
    // rather than being recorded as live and silently never updating.
    const active = new Set(sessionSubs.map((s) => s.name));
    const toAdd = [...desired].filter((name) => !active.has(name));
    const toRemove = sessionSubs.filter((s) => !desired.has(s.name));

    const added = await this.applyVariableToggles(sessionId, toAdd, true);
    added.forEach((name) => active.add(name));
    const removed = await this.applyVariableToggles(
      sessionId,
      toRemove.map((s) => s.name),
      false,
    );
    removed.forEach((name) => active.delete(name));

    this.activeVariableSubs = [
      ...this.activeVariableSubs.filter((s) => s.sessionId !== sessionId),
      ...[...active].map((name) => ({ name, sessionId })),
    ];
  }

  // [LAW:no-silent-failure] Surfaces every toggle failure via the same `error` channel as the
  // variable dump, and returns the names that actually toggled so the caller's tracker reflects
  // real protocol state instead of intent.
  private async applyVariableToggles(
    sessionId: string,
    names: readonly string[],
    subscribe: boolean,
  ): Promise<string[]> {
    const succeeded: string[] = [];
    for (const name of names) {
      try {
        await this.toggleVariableSubscription(sessionId, name, subscribe);
        succeeded.push(name);
      } catch (err) {
        this.emit('error', err);
      }
    }
    return succeeded;
  }

  private async toggleVariableSubscription(
    sessionId: string,
    name: string,
    subscribe: boolean,
  ): Promise<void> {
    await this.sendNotificationRequest(
      NotificationType.NOTIFY_ON_VARIABLE_CHANGE,
      '',
      subscribe,
      {
        arguments: {
          case: 'variableMonitorRequest',
          value: {
            name,
            scope: VariableScope.SESSION,
            identifier: sessionId,
          },
        },
      },
    );
  }

  private async fetchAllVariablesForSession(
    sessionId: string,
  ): Promise<VariableDump> {
    return this.fetchAllVariablesForEntity(sessionVariableEntity(sessionId));
  }

  // Returns the dict together with the frameSeq of the response frame, so the dump's variable-change
  // events can be attributed to the exact wire frame that carried them (a dump resolves to a frame
  // only — there is no notification — and that absence is the live-vs-dump distinction).
  private async fetchAllVariablesForEntity(
    entity: AppEntityRef,
  ): Promise<VariableDump> {
    const req = create(VariableRequestSchema, {
      scope: variableRequestScope(entity),
      get: ['*'],
    });
    const { message: response, frameSeq } = await this.protocol.send({
      submessage: { case: 'variableRequest' as const, value: req },
    });
    if (response.submessage.case !== 'variableResponse') return { dict: {}, frameSeq };
    const values = response.submessage.value.values;
    if (values.length === 0) return { dict: {}, frameSeq };
    try {
      return { dict: JSON.parse(values[0]) as Record<string, unknown>, frameSeq };
    } catch {
      return { dict: {}, frameSeq };
    }
  }

  // [LAW:composability] The caller supplies the staleness policy as a value (`isCurrent`) rather than
  // this fetch knowing about connect-attempt epochs: the connect sequence passes its epoch check so a
  // buffer fetched during a window the sequence was superseded in is not applied after a newer attempt
  // took over, while the focus/refetch callers omit it. The check sits between the send (await) and the
  // apply (effect) — fetch -> check -> apply — exactly where the rest of the sequence guards its effects.
  private async fetchScreenBuffer(
    sessionId: string,
    incremental = false,
    isCurrent?: () => boolean,
  ): Promise<void> {
    if (this.monitor.screen.buffer.sessionId !== sessionId) return;
    const lineRange = incremental
      ? create(LineRangeSchema, { screenContentsOnly: true })
      : create(LineRangeSchema, { trailingLines: 1000 });
    const req = create(GetBufferRequestSchema, {
      session: sessionId,
      lineRange,
      includeStyles: true,
    });
    this.monitor.screen.noteFetchStarted();
    try {
      const { message: response } = await this.protocol.send({
        submessage: { case: 'getBufferRequest' as const, value: req },
      });
      if (isCurrent && !isCurrent()) return; // superseded mid-fetch; the newer attempt owns the screen
      if (response.submessage.case === 'getBufferResponse') {
        const { lines, cursor, baseLine } = convertGetBuffer(response.submessage.value);
        this.monitor.screen.applyBuffer(sessionId, lines, cursor, baseLine);
      } else {
        this.monitor.screen.noteFetchFailed(
          response.submessage.case === 'error'
            ? response.submessage.value
            : `unexpected case ${response.submessage.case ?? '<none>'}`,
        );
      }
    } catch (err) {
      this.monitor.screen.noteFetchFailed((err as Error).message);
      this.emit('error', err);
    }
  }

  // [LAW:dataflow-not-control-flow] Always refetch whatever session the screen pane is focused on now;
  // the scheduler decides *when*, this decides *what*. Reading the focused session at fire time (not
  // capturing it at request time) means a focus change between a notification and its coalesced refetch
  // resolves to the current pane, and fetchScreenBuffer's own session guard drops a stale fetch.
  private async refetchFocusedScreen(): Promise<void> {
    const sessionId = this.monitor.screen.buffer.sessionId;
    if (!sessionId) return;
    // [LAW:no-silent-failure] No swallow here: fetchScreenBuffer wraps its protocol call in try/catch and
    // surfaces every failure (noteFetchFailed on the store + emit 'error'), so it never rejects and the
    // failure is already reported. A blanket .catch would only hide an unexpected rejection.
    await this.fetchScreenBuffer(sessionId, true);
  }

  private routeNotification(n: Notification, frameSeq: number, causeSeq: number): void {
    if (n.layoutChangedNotification?.listSessionsResponse) {
      this.monitor.layout.apply(convertLayout(n.layoutChangedNotification.listSessionsResponse));
    }
    if (n.variableChangedNotification) {
      const v = n.variableChangedNotification;
      if (v.identifier && v.name) {
        // [LAW:no-ambient-temporal-coupling] The change carries the notification's frameSeq, so it
        // joins to that notification and the wire frame that delivered it by foreign key.
        this.monitor.variables.applyChange(
          v.identifier,
          v.name,
          v.jsonNewValue ?? 'null',
          variableScopeName(v.scope),
          frameSeq,
        );
      }
    }
    if (n.terminateSessionNotification?.sessionId) {
      this.monitor.variables.clearSession(n.terminateSessionNotification.sessionId);
    }
    if (n.screenUpdateNotification) {
      const session = n.screenUpdateNotification.session;
      if (session && this.monitor.screen.buffer.sessionId === session) {
        this.screenRefetch.request();
      }
    }
    if (n.promptNotification) {
      // [LAW:dataflow-not-control-flow] The prompt notification becomes a typed update applied to the
      // prompt store; the store's focus guard owns "is this the focused session", so no branch on session
      // is re-derived here. A notification the converter cannot place (no session / unknown event) is
      // dropped at the boundary, never defaulted onto the wrong prompt.
      const converted = convertPromptNotification(n.promptNotification);
      if (converted) this.monitor.prompt.applyUpdate(converted.sessionId, converted.update);
    }
    if (n.customEscapeSequenceNotification) {
      this.monitor.customEscape.record(n.customEscapeSequenceNotification);
    }
    if (n.serverOriginatedRpcNotification?.rpc) {
      void this.handleServerRpc(
        n.serverOriginatedRpcNotification.requestId,
        n.serverOriginatedRpcNotification.rpc,
        frameSeq,
        causeSeq,
      );
    }
  }

  private async handleServerRpc(
    requestId: string,
    rpc: { name: string; arguments: Array<{ name: string; jsonValue: string }> },
    frameSeq: number,
    causeSeq: number,
  ): Promise<void> {
    if (rpc.name === PROBE_EVAL_FUNCTION) {
      // The probe round-trip: iTerm2 has already interpolated the template against the focused scope,
      // so the evaluated value IS the single argument. Echo it straight back as the result; it
      // returns to the waiting probe through the InvokeFunctionResponse. This is an internal probe
      // mechanism, not a user registration, so it never lands on the invocation spine.
      // [LAW:decomposition]
      const arg = rpc.arguments.find((a) => a.name === PROBE_EVAL_ARG);
      if (!arg) {
        // [LAW:no-silent-failure] probe_eval is registered with exactly one argument and iTerm2 must
        // deliver the interpolated value in it; its absence is a protocol violation, not an unset
        // value. Fail the invocation loudly so the probe surfaces an error, never a phantom "null".
        await this.respondToServerRpcException(
          requestId,
          `${PROBE_EVAL_FUNCTION} invoked without its "${PROBE_EVAL_ARG}" argument`,
        );
        return;
      }
      await this.respondToServerRpc(requestId, arg.jsonValue);
      return;
    }
    const spec = this.monitor.registrations.findByName(rpc.name);
    const args: Record<string, unknown> = {};
    for (const a of rpc.arguments) {
      try {
        args[a.name] = JSON.parse(a.jsonValue);
      } catch {
        args[a.name] = a.jsonValue;
      }
    }
    if (!spec) {
      const error = `no registration for name=${rpc.name}`;
      await this.respondToServerRpcException(requestId, error);
      this.appendInvocation(
        { rpcName: rpc.name, registrationId: '', requestId, args, responded: true, responseJson: '', error },
        frameSeq,
        causeSeq,
      );
      return;
    }
    try {
      JSON.parse(spec.responseTemplate);
      await this.respondToServerRpc(requestId, spec.responseTemplate);
      this.appendInvocation(
        {
          rpcName: rpc.name,
          registrationId: spec.id,
          requestId,
          args,
          responded: true,
          responseJson: spec.responseTemplate,
          error: null,
        },
        frameSeq,
        causeSeq,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.respondToServerRpcException(requestId, msg);
      this.appendInvocation(
        { rpcName: rpc.name, registrationId: spec.id, requestId, args, responded: true, responseJson: '', error: msg },
        frameSeq,
        causeSeq,
      );
    }
  }

  // [LAW:one-source-of-truth] An invocation is one event on the spine, carrying the frameSeq of the
  // notification frame it was decoded from and causedBy = that notification's seq. Server RPCs are
  // app-scoped registrations, so the invocation is app-scoped; its session context, when any, is
  // reachable by walking causedBy to the notification. The emit lets main re-broadcast the
  // registrations snapshot (whose invocation list is a projection of this spine).
  private appendInvocation(
    payload: AppInvocationPayload,
    frameSeq: number,
    causeSeq: number,
  ): void {
    this.monitor.appEvents.append({
      kind: 'invocation',
      at: Date.now(),
      frameSeq,
      entity: APP_ENTITY,
      causedBy: causeSeq,
      payload,
    });
    this.emit('invocation');
  }
}

interface VariableDump {
  dict: Record<string, unknown>;
  frameSeq: number;
}

// [LAW:one-source-of-truth] Decoded once, here at the boundary that owns the bytes — the wire pane
// reads messageKind/requestId off the stored event and never re-parses. Mirrors the decode the
// deleted WireLogStore did, now feeding the unified spine.
function decodeWireFrame(
  direction: 'out' | 'in',
  bytes: Uint8Array,
): { messageKind: string; requestId: string } {
  try {
    const schema = direction === 'out' ? ClientOriginatedMessageSchema : ServerOriginatedMessageSchema;
    const msg = fromBinary(schema, bytes);
    return { messageKind: msg.submessage.case ?? '(empty)', requestId: msg.id.toString() };
  } catch {
    return { messageKind: '(decode-failed)', requestId: '0' };
  }
}

// A notification's scope is whatever entity it names; sessionless notifications are app-scoped. This
// is best-effort scoping for the unified timeline, not a precise focus ref (window/tab are unknown
// from a session id alone).
function notificationEntity(sessionId: string | null): AppEntityRef {
  return sessionId ? sessionVariableEntity(sessionId) : APP_ENTITY;
}

function errString(err: unknown): string {
  if (err instanceof AppleScriptError || err instanceof ProtocolError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// [LAW:no-silent-failure] iTerm2 confirms every (un)subscribe with a NotificationResponse.status;
// transport delivery is not subscription success. A non-OK status (SESSION_NOT_FOUND,
// ALREADY_SUBSCRIBED, NOT_SUBSCRIBED, DUPLICATE_SERVER_ORIGINATED_RPC, INVALID_IDENTIFIER,
// REQUEST_MALFORMED) is a refusal every subscribe path was trusting as success — surface it as the
// named status. [LAW:effects-at-boundaries] Pure verdict, no IO: the caller awaits the send and throws
// this, the same decision/effect split tmuxStatusError makes for action responses. Returns the error
// string, or null when iTerm2 accepted the request.
export function notificationRefusal(
  response: ServerOriginatedMessage,
  type: NotificationType,
  subscribe: boolean,
): string | null {
  const what = `${subscribe ? 'subscribe' : 'unsubscribe'}(${NotificationType[type]})`;
  if (response.submessage.case === 'error') {
    return `${what} failed: ${response.submessage.value}`;
  }
  if (response.submessage.case !== 'notificationResponse') {
    return `${what} got unexpected response: ${response.submessage.case ?? '<none>'}`;
  }
  const status = response.submessage.value.status;
  if (status !== NotificationResponse_Status.OK) {
    return `${what} refused: ${NotificationResponse_Status[status] ?? status}`;
  }
  return null;
}

function variableRequestScope(entity: AppEntityRef):
  | { case: 'app'; value: boolean }
  | { case: 'windowId'; value: string }
  | { case: 'tabId'; value: string }
  | { case: 'sessionId'; value: string } {
  // [LAW:types-are-the-program] Variable focus and request scope share one discriminated entity shape.
  switch (entity.kind) {
    case 'app':
      return { case: 'app', value: true };
    case 'window':
      return { case: 'windowId', value: entity.windowId };
    case 'tab':
      return { case: 'tabId', value: entity.tabId };
    case 'session':
      return { case: 'sessionId', value: entity.sessionId };
  }
}

function invokeFunctionContext(entity: AppEntityRef): InvokeFunctionRequest['context'] {
  // [LAW:types-are-the-program] The same discriminated entity that scopes a VariableRequest scopes
  // the probe_eval invocation, so iTerm2 interpolates the template against the focused entity.
  switch (entity.kind) {
    case 'app':
      return { case: 'app', value: create(InvokeFunctionRequest_AppSchema, {}) };
    case 'window':
      return {
        case: 'window',
        value: create(InvokeFunctionRequest_WindowSchema, { windowId: entity.windowId }),
      };
    case 'tab':
      return {
        case: 'tab',
        value: create(InvokeFunctionRequest_TabSchema, { tabId: entity.tabId }),
      };
    case 'session':
      return {
        case: 'session',
        value: create(InvokeFunctionRequest_SessionSchema, { sessionId: entity.sessionId }),
      };
  }
}

function sessionVariableEntity(sessionId: string): AppEntityRef {
  // [LAW:single-enforcer] Session variable snapshots are keyed by protocol session identity.
  return {
    kind: 'session',
    windowId: '',
    tabId: '',
    sessionId,
  };
}
