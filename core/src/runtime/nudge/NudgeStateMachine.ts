/** Pure immutable lifecycle coordinator for one Pending Nudge snapshot. */
import {
  NUDGE_DELIVERY,
  PENDING_NUDGE_STATE,
  type PendingNudge,
  type PendingNudgeState,
} from "./NudgeProtocol.js";
import {
  capturePendingNudge,
} from "./NudgeProtocolValidator.js";
import {
  NUDGE_STATE_MACHINE_FAILURE,
  NudgeStateMachineError,
} from "./NudgeStateMachineErrors.js";

export const NUDGE_STATE_ACTION = {
  lease: "lease",
  release: "release",
  dispatchConfirmed: "dispatch_confirmed",
  activate: "activate",
  consume: "consume",
  acknowledge: "acknowledge",
  resolve: "resolve",
  expire: "expire",
  supersede: "supersede",
} as const;

export type NudgeStateAction =
  (typeof NUDGE_STATE_ACTION)[keyof typeof NUDGE_STATE_ACTION];

type StateTransition = {
  readonly from: PendingNudgeState;
  readonly to: PendingNudgeState;
};

const TRANSITIONS: ReadonlyMap<NudgeStateAction, readonly StateTransition[]> =
  new Map([
    [NUDGE_STATE_ACTION.lease, [
      transition(PENDING_NUDGE_STATE.scheduled, PENDING_NUDGE_STATE.leased),
    ]],
    [NUDGE_STATE_ACTION.release, [
      transition(PENDING_NUDGE_STATE.leased, PENDING_NUDGE_STATE.scheduled),
    ]],
    [NUDGE_STATE_ACTION.dispatchConfirmed, [
      transition(PENDING_NUDGE_STATE.leased, PENDING_NUDGE_STATE.applied),
    ]],
    [NUDGE_STATE_ACTION.activate, [
      transition(PENDING_NUDGE_STATE.applied, PENDING_NUDGE_STATE.active),
    ]],
    [NUDGE_STATE_ACTION.consume, [
      transition(PENDING_NUDGE_STATE.applied, PENDING_NUDGE_STATE.consumed),
    ]],
    [NUDGE_STATE_ACTION.acknowledge, [
      transition(PENDING_NUDGE_STATE.active, PENDING_NUDGE_STATE.acknowledged),
    ]],
    [NUDGE_STATE_ACTION.resolve, [
      transition(PENDING_NUDGE_STATE.active, PENDING_NUDGE_STATE.resolved),
    ]],
    [NUDGE_STATE_ACTION.expire, [
      transition(PENDING_NUDGE_STATE.scheduled, PENDING_NUDGE_STATE.expired),
      transition(PENDING_NUDGE_STATE.active, PENDING_NUDGE_STATE.expired),
    ]],
    [NUDGE_STATE_ACTION.supersede, [
      transition(PENDING_NUDGE_STATE.scheduled, PENDING_NUDGE_STATE.superseded),
      transition(PENDING_NUDGE_STATE.active, PENDING_NUDGE_STATE.superseded),
    ]],
  ]);

const IDEMPOTENT_TERMINAL_ACTIONS: ReadonlyMap<
  NudgeStateAction,
  PendingNudgeState
> = new Map([
  [NUDGE_STATE_ACTION.consume, PENDING_NUDGE_STATE.consumed],
  [NUDGE_STATE_ACTION.acknowledge, PENDING_NUDGE_STATE.acknowledged],
  [NUDGE_STATE_ACTION.resolve, PENDING_NUDGE_STATE.resolved],
  [NUDGE_STATE_ACTION.expire, PENDING_NUDGE_STATE.expired],
  [NUDGE_STATE_ACTION.supersede, PENDING_NUDGE_STATE.superseded],
]);

export class NudgeStateMachine {
  transition(source: PendingNudge, action: NudgeStateAction): PendingNudge {
    let nudge: PendingNudge;
    try {
      nudge = capturePendingNudge(source);
    } catch {
      throw new NudgeStateMachineError(NUDGE_STATE_MACHINE_FAILURE.invalidNudge);
    }
    if (!isNudgeStateAction(action)) {
      throw new NudgeStateMachineError(
        NUDGE_STATE_MACHINE_FAILURE.invalidAction,
        nudge.id,
        nudge.state,
      );
    }

    const idempotentState = IDEMPOTENT_TERMINAL_ACTIONS.get(action);
    if (idempotentState === nudge.state) return nudge;
    if (action === NUDGE_STATE_ACTION.activate && nudge.delivery === NUDGE_DELIVERY.once) {
      throw illegalTransition(nudge, action);
    }
    if (
      action === NUDGE_STATE_ACTION.consume &&
      nudge.delivery !== NUDGE_DELIVERY.once
    ) {
      throw illegalTransition(nudge, action);
    }
    if (
      action === NUDGE_STATE_ACTION.acknowledge &&
      nudge.delivery !== NUDGE_DELIVERY.untilAcknowledged
    ) {
      throw illegalTransition(nudge, action);
    }
    if (
      action === NUDGE_STATE_ACTION.resolve &&
      nudge.delivery !== NUDGE_DELIVERY.untilCondition
    ) {
      throw illegalTransition(nudge, action);
    }

    const transition = TRANSITIONS.get(action)?.find(
      (candidate) => candidate.from === nudge.state,
    );
    if (!transition) throw illegalTransition(nudge, action);
    return Object.freeze({ ...nudge, state: transition.to });
  }
}

function transition(
  from: PendingNudgeState,
  to: PendingNudgeState,
): StateTransition {
  return Object.freeze({ from, to });
}

function isNudgeStateAction(value: unknown): value is NudgeStateAction {
  return Object.values(NUDGE_STATE_ACTION).includes(value as NudgeStateAction);
}

function illegalTransition(
  nudge: PendingNudge,
  action: NudgeStateAction,
): NudgeStateMachineError {
  return new NudgeStateMachineError(
    NUDGE_STATE_MACHINE_FAILURE.illegalTransition,
    nudge.id,
    nudge.state,
    action,
  );
}
