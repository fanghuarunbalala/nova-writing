/** Serial child lifecycle authority with bounded concurrent provisioning. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  CHILD_CONVERSATION_MANAGER_FAILURE,
  ChildConversationManagerError,
  type ChildConversationManagerErrorIdentity,
  type ChildConversationManagerFailure,
} from "./ChildConversationManagerErrors.js";
import type {
  ChildConversationActivationPort,
  ChildConversationBindingPersistencePort,
  ChildConversationCapacitySnapshot,
  ChildConversationCreation,
  ChildConversationCreationPort,
  ChildConversationManager,
  ChildConversationManagerClock,
  ChildConversationRollbackPort,
  ChildConversationTaskAssignmentPort,
  SubagentParentScope,
  SubagentParentScopeReader,
  SubagentToolPolicyRelationReader,
} from "./ChildConversationManagerProtocol.js";
import {
  SUBAGENT_LIMITS,
  SUBAGENT_SCHEMA_VERSION,
  SUBAGENT_STATUS,
  type SubagentBinding,
  type SubagentRequest,
  type SubagentTerminalStatus,
} from "./SubagentProtocol.js";
import {
  captureSubagentBinding,
  captureSubagentRequest,
} from "./SubagentProtocolValidator.js";
import { SubagentToolPolicyReductionVerifier } from "./SubagentToolPolicyReductionVerifier.js";

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export interface DefaultChildConversationManagerOptions {
  readonly parentScopeReader: SubagentParentScopeReader;
  readonly toolPolicyRelationReader: SubagentToolPolicyRelationReader;
  readonly creationPort: ChildConversationCreationPort;
  readonly activationPort: ChildConversationActivationPort;
  readonly rollbackPort: ChildConversationRollbackPort;
  readonly taskAssignmentPort?: ChildConversationTaskAssignmentPort;
  readonly bindingPersistencePort?: ChildConversationBindingPersistencePort;
  readonly clock?: ChildConversationManagerClock;
  readonly logger?: Logger;
}

interface ReservedCapacity {
  readonly parentConversationId: string;
  readonly parentRunId: string;
  readonly parentRunKey: string;
}

export class DefaultChildConversationManager
  implements ChildConversationManager
{
  readonly #bindings = new Map<string, SubagentBinding>();
  readonly #capacityOwners = new Map<string, ReservedCapacity>();
  readonly #activeByParentRun = new Map<string, number>();
  readonly #serializer = new SubagentManagerSerializer();
  readonly #policyVerifier: SubagentToolPolicyReductionVerifier;
  readonly #clock: ChildConversationManagerClock;
  readonly #logger: Logger;
  #activeGlobal = 0;

  constructor(private readonly options: DefaultChildConversationManagerOptions) {
    this.#policyVerifier = new SubagentToolPolicyReductionVerifier(
      options.toolPolicyRelationReader,
    );
    this.#clock = options.clock ?? SYSTEM_CHILD_CONVERSATION_MANAGER_CLOCK;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "child_conversation_manager",
    });
  }

  async spawn(requestSource: SubagentRequest): Promise<SubagentBinding> {
    const request = captureSubagentRequest(requestSource);
    const identity = requestIdentity(request);
    const existing = await this.#serializer.run(() =>
      this.#findRetryableBinding(request),
    );
    if (existing !== undefined) {
      this.#logger.info("runtime.subagent.spawn_duplicate_reused", { ...identity });
      return existing;
    }
    const parentScope = await this.#readParentScope(request, identity);
    if (parentScope.depth >= SUBAGENT_LIMITS.maximumDepth) {
      this.#logger.info("runtime.subagent.spawn_rejected", {
        ...identity,
        failure: CHILD_CONVERSATION_MANAGER_FAILURE.nestedSubagentForbidden,
      });
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.nestedSubagentForbidden,
        identity,
      );
    }

    try {
      await this.#policyVerifier.verify(
        parentScope.toolPolicyId,
        request.toolPolicyId,
        identity,
      );
      await this.#serializer.run(() => this.#reserve(request));
    } catch (error) {
      const failure =
        error instanceof ChildConversationManagerError
          ? error.failure
          : CHILD_CONVERSATION_MANAGER_FAILURE.toolPolicyUnavailable;
      this.#logger.info("runtime.subagent.spawn_rejected", {
        ...identity,
        failure,
      });
      throw managerFailure(failure, identity);
    }

    let creation: ChildConversationCreation;
    try {
      creation = captureChildConversationCreation(
        await this.options.creationPort.createChild(
          Object.freeze({
            subagentId: request.subagentId,
            workspaceId: parentScope.workspaceId,
            parentConversationId: request.parentConversationId,
            parentRunId: request.parentRunId,
            agentType: request.agentType,
            definitionVersion: request.definitionVersion,
            toolPolicyId: request.toolPolicyId,
            requestedAt: request.requestedAt,
          }),
        ),
        request,
      );
    } catch (error) {
      await this.#serializer.run(() => this.#releaseCapacity(request.subagentId));
      const failure =
        error instanceof ChildConversationManagerError
          ? error.failure
          : CHILD_CONVERSATION_MANAGER_FAILURE.childCreationFailed;
      this.#logger.info("runtime.subagent.creation_failed", {
        ...identity,
        failure,
      });
      throw managerFailure(failure, identity);
    }

    const creatingBinding = await this.#serializer.run(() =>
      this.#recordCreatedBinding(request, creation),
    );

    try {
      await this.#persistBinding(creatingBinding);
      await this.#assignTask(creatingBinding, request);
    } catch (error) {
      const rollbackFailed = await this.#rollback(creatingBinding);
      const failedBinding = await this.#serializer.run(() =>
        this.#recordProvisioningFailure(creatingBinding, rollbackFailed),
      );
      await this.#persistBindingBestEffort(failedBinding);
      const failure = rollbackFailed
        ? CHILD_CONVERSATION_MANAGER_FAILURE.childRollbackFailed
        : error instanceof ChildConversationManagerError
          ? error.failure
          : CHILD_CONVERSATION_MANAGER_FAILURE.childTaskAssignmentFailed;
      this.#logger.info("runtime.subagent.task_assignment_failed", {
        ...identity,
        childConversationId: failedBinding.childConversationId,
        failure,
      });
      throw managerFailure(failure, {
        ...identity,
        childConversationId: failedBinding.childConversationId,
      });
    }

    this.#logger.debug("runtime.subagent.child_created", {
      ...identity,
      childConversationId: creatingBinding.childConversationId,
    });

    try {
      await this.options.activationPort.activateChild(creatingBinding);
    } catch {
      const rollbackFailed = await this.#rollback(creatingBinding);
      const failedBinding = await this.#serializer.run(() =>
        this.#recordProvisioningFailure(creatingBinding, rollbackFailed),
      );
      const failure = rollbackFailed
        ? CHILD_CONVERSATION_MANAGER_FAILURE.childRollbackFailed
        : CHILD_CONVERSATION_MANAGER_FAILURE.childActivationFailed;
      this.#logger.info("runtime.subagent.activation_failed", {
        ...identity,
        childConversationId: failedBinding.childConversationId,
        failure,
      });
      throw managerFailure(failure, {
        ...identity,
        childConversationId: failedBinding.childConversationId,
      });
    }

    const runningBinding = await this.#serializer.run(() =>
      this.#recordRunning(creatingBinding),
    );
    await this.#persistBinding(runningBinding);
    this.#logger.info("runtime.subagent.activated", {
      ...identity,
      childConversationId: runningBinding.childConversationId,
    });
    return runningBinding;
  }

  recordTerminalStatus(
    subagentId: string,
    status: SubagentTerminalStatus,
    updatedAt = this.#clock.now(),
  ): Promise<SubagentBinding> {
    let capturedSubagentId: string;
    let capturedStatus: SubagentTerminalStatus;
    let capturedUpdatedAt: string;
    try {
      capturedSubagentId = captureIdentity(subagentId);
      capturedStatus = captureTerminalStatus(status);
      capturedUpdatedAt = captureTimestamp(updatedAt);
    } catch {
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.invalidTerminalTransition,
        typeof subagentId === "string" && IDENTITY.test(subagentId)
          ? { subagentId }
          : {},
      );
    }
    return this.#serializer.run(() => {
      const current = this.#bindings.get(capturedSubagentId);
      if (!current) {
        throw managerFailure(
          CHILD_CONVERSATION_MANAGER_FAILURE.bindingNotFound,
          { subagentId: capturedSubagentId },
        );
      }
      if (isTerminal(current.status)) {
        throw managerFailure(
          CHILD_CONVERSATION_MANAGER_FAILURE.bindingAlreadyTerminal,
          bindingIdentity(current),
        );
      }
      if (current.status !== SUBAGENT_STATUS.running) {
        throw managerFailure(
          CHILD_CONVERSATION_MANAGER_FAILURE.invalidTerminalTransition,
          bindingIdentity(current),
        );
      }
      if (capturedUpdatedAt < current.updatedAt) {
        throw managerFailure(
          CHILD_CONVERSATION_MANAGER_FAILURE.invalidTerminalTransition,
          bindingIdentity(current),
        );
      }

      const terminal = captureSubagentBinding({
        ...current,
        status: capturedStatus,
        updatedAt: capturedUpdatedAt,
      });
      this.#bindings.set(capturedSubagentId, terminal);
      this.#releaseCapacity(capturedSubagentId);
      this.#logger.info("runtime.subagent.terminal_recorded", {
        ...bindingIdentity(terminal),
        status: terminal.status,
      });
      return terminal;
    });
  }

  getBinding(subagentId: string): SubagentBinding | undefined {
    return this.#bindings.get(subagentId);
  }

  listBindings(): readonly SubagentBinding[] {
    return Object.freeze([...this.#bindings.values()]);
  }

  getCapacity(
    parentConversationId: string,
    parentRunId: string,
  ): ChildConversationCapacitySnapshot {
    const parentRunKey = makeParentRunKey(parentConversationId, parentRunId);
    return Object.freeze({
      activeGlobal: this.#activeGlobal,
      activeForParentRun: this.#activeByParentRun.get(parentRunKey) ?? 0,
    });
  }

  #findRetryableBinding(request: SubagentRequest): SubagentBinding | undefined {
    const existing = this.#bindings.get(request.subagentId);
    if (existing === undefined) return undefined;
    if (
      existing.parentConversationId !== request.parentConversationId ||
      existing.parentRunId !== request.parentRunId ||
      existing.agentType !== request.agentType ||
      existing.definitionVersion !== request.definitionVersion ||
      existing.toolPolicyId !== request.toolPolicyId
    ) {
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.duplicateSubagent,
        requestIdentity(request),
      );
    }
    if (
      existing.status === SUBAGENT_STATUS.creating ||
      existing.status === SUBAGENT_STATUS.running
    ) {
      return existing;
    }
    throw managerFailure(
      CHILD_CONVERSATION_MANAGER_FAILURE.duplicateSubagent,
      bindingIdentity(existing),
    );
  }

  async #readParentScope(
    request: SubagentRequest,
    identity: ChildConversationManagerErrorIdentity,
  ): Promise<SubagentParentScope> {
    try {
      return captureParentScope(
        await this.options.parentScopeReader.readParentScope(request),
        request,
      );
    } catch (error) {
      const failure =
        error instanceof ChildConversationManagerError
          ? error.failure
          : CHILD_CONVERSATION_MANAGER_FAILURE.parentScopeUnavailable;
      this.#logger.info("runtime.subagent.parent_scope_failed", {
        ...identity,
        failure,
      });
      throw managerFailure(failure, identity);
    }
  }

  #reserve(request: SubagentRequest): void {
    const identity = requestIdentity(request);
    if (
      this.#bindings.has(request.subagentId) ||
      this.#capacityOwners.has(request.subagentId)
    ) {
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.duplicateSubagent,
        identity,
      );
    }

    const parentRunKey = makeParentRunKey(
      request.parentConversationId,
      request.parentRunId,
    );
    const activeForParentRun = this.#activeByParentRun.get(parentRunKey) ?? 0;
    if (activeForParentRun >= SUBAGENT_LIMITS.maximumActivePerParentRun) {
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.parentRunLimitExceeded,
        identity,
      );
    }
    if (this.#activeGlobal >= SUBAGENT_LIMITS.maximumActiveGlobal) {
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.globalLimitExceeded,
        identity,
      );
    }

    this.#capacityOwners.set(
      request.subagentId,
      Object.freeze({
        parentConversationId: request.parentConversationId,
        parentRunId: request.parentRunId,
        parentRunKey,
      }),
    );
    this.#activeGlobal += 1;
    this.#activeByParentRun.set(parentRunKey, activeForParentRun + 1);
    this.#logger.debug("runtime.subagent.capacity_reserved", {
      ...identity,
      activeGlobal: this.#activeGlobal,
      activeForParentRun: activeForParentRun + 1,
    });
  }

  #recordCreatedBinding(
    request: SubagentRequest,
    creation: ChildConversationCreation,
  ): SubagentBinding {
    if (!this.#capacityOwners.has(request.subagentId)) {
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.invalidChildCreation,
        requestIdentity(request),
      );
    }
    if (
      creation.childConversationId === request.parentConversationId ||
      [...this.#bindings.values()].some(
        (binding) =>
          binding.childConversationId === creation.childConversationId,
      )
    ) {
      this.#releaseCapacity(request.subagentId);
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.invalidChildCreation,
        {
          ...requestIdentity(request),
          childConversationId: creation.childConversationId,
        },
      );
    }

    const binding = captureSubagentBinding({
      schemaVersion: SUBAGENT_SCHEMA_VERSION,
      subagentId: request.subagentId,
      parentConversationId: request.parentConversationId,
      parentRunId: request.parentRunId,
      ...(request.parentTurnId === undefined
        ? {}
        : { parentTurnId: request.parentTurnId }),
      childConversationId: creation.childConversationId,
      depth: 1,
      agentType: request.agentType,
      definitionVersion: request.definitionVersion,
      toolPolicyId: request.toolPolicyId,
      status: SUBAGENT_STATUS.creating,
      createdAt: creation.createdAt,
      updatedAt: creation.createdAt,
    });
    this.#bindings.set(binding.subagentId, binding);
    return binding;
  }

  #recordRunning(binding: SubagentBinding): SubagentBinding {
    const current = this.#bindings.get(binding.subagentId);
    if (
      current?.status !== SUBAGENT_STATUS.creating ||
      current.childConversationId !== binding.childConversationId
    ) {
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.invalidTerminalTransition,
        bindingIdentity(binding),
      );
    }
    const running = captureSubagentBinding({
      ...current,
      status: SUBAGENT_STATUS.running,
      updatedAt: monotonicTimestamp(this.#clock.now(), current.updatedAt),
    });
    this.#bindings.set(running.subagentId, running);
    return running;
  }

  async #assignTask(
    binding: SubagentBinding,
    request: SubagentRequest,
  ): Promise<void> {
    if (this.options.taskAssignmentPort === undefined) return;
    let receipt;
    try {
      receipt = await this.options.taskAssignmentPort.assignTask(binding, request);
    } catch {
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.childTaskAssignmentFailed,
        bindingIdentity(binding),
      );
    }
    if (
      receipt === null ||
      typeof receipt !== "object" ||
      receipt.conversationId !== binding.childConversationId ||
      (receipt.status !== "accepted" && receipt.status !== "duplicate") ||
      typeof receipt.inputEventId !== "string" ||
      receipt.inputEventId.trim().length === 0 ||
      !Number.isSafeInteger(receipt.sequence) ||
      receipt.sequence <= 0
    ) {
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.childTaskAssignmentInvalid,
        bindingIdentity(binding),
      );
    }
    this.#logger.info("runtime.subagent.task_assigned", {
      ...bindingIdentity(binding),
      journalStatus: receipt.status,
      inputSequence: receipt.sequence,
    });
  }

  async #persistBinding(binding: SubagentBinding): Promise<void> {
    if (this.options.bindingPersistencePort === undefined) return;
    try {
      await this.options.bindingPersistencePort.persist(binding);
    } catch {
      throw managerFailure(
        CHILD_CONVERSATION_MANAGER_FAILURE.childBindingPersistenceFailed,
        bindingIdentity(binding),
      );
    }
  }

  async #persistBindingBestEffort(binding: SubagentBinding): Promise<void> {
    try {
      await this.#persistBinding(binding);
    } catch {
      this.#logger.warn("runtime.subagent.binding_persistence_failed", {
        ...bindingIdentity(binding),
        failure: CHILD_CONVERSATION_MANAGER_FAILURE.childBindingPersistenceFailed,
      });
    }
  }

  #recordProvisioningFailure(
    binding: SubagentBinding,
    rollbackFailed: boolean,
  ): SubagentBinding {
    const current = this.#bindings.get(binding.subagentId) ?? binding;
    const failed = captureSubagentBinding({
      ...current,
      status: rollbackFailed
        ? SUBAGENT_STATUS.orphaned
        : SUBAGENT_STATUS.failed,
      updatedAt: monotonicTimestamp(this.#clock.now(), current.updatedAt),
    });
    this.#bindings.set(failed.subagentId, failed);
    this.#releaseCapacity(failed.subagentId);
    return failed;
  }

  async #rollback(binding: SubagentBinding): Promise<boolean> {
    try {
      await this.options.rollbackPort.rollbackChild(binding);
      return false;
    } catch {
      return true;
    }
  }

  #releaseCapacity(subagentId: string): void {
    const capacity = this.#capacityOwners.get(subagentId);
    if (!capacity) return;
    this.#capacityOwners.delete(subagentId);
    this.#activeGlobal -= 1;
    const activeForParentRun =
      (this.#activeByParentRun.get(capacity.parentRunKey) ?? 1) - 1;
    if (activeForParentRun === 0) {
      this.#activeByParentRun.delete(capacity.parentRunKey);
    } else {
      this.#activeByParentRun.set(capacity.parentRunKey, activeForParentRun);
    }
  }
}

class SubagentManagerSerializer {
  #tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const SYSTEM_CHILD_CONVERSATION_MANAGER_CLOCK: ChildConversationManagerClock =
  Object.freeze({
    now: () => new Date().toISOString(),
  });

function captureParentScope(
  value: unknown,
  request: SubagentRequest,
): SubagentParentScope {
  try {
    const record = plainRecord(value);
    if (
      !record ||
      hasUnknownKeys(record, [
        "parentConversationId",
        "parentRunId",
        "workspaceId",
        "depth",
        "toolPolicyId",
      ])
    ) {
      throw new Error();
    }
    const scope = Object.freeze({
      parentConversationId: captureIdentity(record.parentConversationId),
      parentRunId: captureIdentity(record.parentRunId),
      workspaceId: captureIdentity(record.workspaceId),
      depth: captureDepth(record.depth),
      toolPolicyId: captureIdentity(record.toolPolicyId),
    });
    if (
      scope.parentConversationId !== request.parentConversationId ||
      scope.parentRunId !== request.parentRunId
    ) {
      throw new Error();
    }
    return scope;
  } catch {
    throw managerFailure(
      CHILD_CONVERSATION_MANAGER_FAILURE.invalidParentScope,
      requestIdentity(request),
    );
  }
}

function captureChildConversationCreation(
  value: unknown,
  request: SubagentRequest,
): ChildConversationCreation {
  try {
    const record = plainRecord(value);
    if (
      !record ||
      hasUnknownKeys(record, ["childConversationId", "createdAt"])
    ) {
      throw new Error();
    }
    return Object.freeze({
      childConversationId: captureIdentity(record.childConversationId),
      createdAt: captureTimestamp(record.createdAt),
    });
  } catch {
    throw managerFailure(
      CHILD_CONVERSATION_MANAGER_FAILURE.invalidChildCreation,
      requestIdentity(request),
    );
  }
}

function captureDepth(value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error();
  return value;
}

function captureIdentity(value: unknown): string {
  if (typeof value !== "string" || !IDENTITY.test(value)) throw new Error();
  return value;
}

function captureTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error();
  }
  return value;
}

function monotonicTimestamp(value: unknown, floor: string): string {
  const captured = captureTimestamp(value);
  return captured < floor ? floor : captured;
}

function captureTerminalStatus(value: unknown): SubagentTerminalStatus {
  if (
    value !== SUBAGENT_STATUS.completed &&
    value !== SUBAGENT_STATUS.failed &&
    value !== SUBAGENT_STATUS.cancelled &&
    value !== SUBAGENT_STATUS.orphaned
  ) {
    throw new Error();
  }
  return value;
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) return undefined;
  }
  return value as Record<string, unknown>;
}

function hasUnknownKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(record);
  return (
    keys.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(record, key))
  );
}

function requestIdentity(
  request: SubagentRequest,
): ChildConversationManagerErrorIdentity & {
  readonly subagentId: string;
  readonly parentConversationId: string;
  readonly parentRunId: string;
} {
  return {
    subagentId: request.subagentId,
    parentConversationId: request.parentConversationId,
    parentRunId: request.parentRunId,
  };
}

function bindingIdentity(
  binding: SubagentBinding,
): ChildConversationManagerErrorIdentity & {
  readonly subagentId: string;
  readonly parentConversationId: string;
  readonly parentRunId: string;
  readonly childConversationId: string;
} {
  return {
    subagentId: binding.subagentId,
    parentConversationId: binding.parentConversationId,
    parentRunId: binding.parentRunId,
    childConversationId: binding.childConversationId,
  };
}

function managerFailure(
  failure: ChildConversationManagerFailure,
  identity: ChildConversationManagerErrorIdentity = {},
): ChildConversationManagerError {
  return new ChildConversationManagerError(failure, identity);
}

function makeParentRunKey(
  parentConversationId: string,
  parentRunId: string,
): string {
  return `${parentConversationId}\u0000${parentRunId}`;
}

function isTerminal(status: SubagentBinding["status"]): boolean {
  return (
    status === SUBAGENT_STATUS.completed ||
    status === SUBAGENT_STATUS.failed ||
    status === SUBAGENT_STATUS.cancelled ||
    status === SUBAGENT_STATUS.orphaned
  );
}
