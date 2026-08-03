/** Deterministic layered Tool permission evaluation with exact one-shot grants. */
import type {
  CapturedToolInvocation,
  ToolApprovalIdentity,
  ToolExecutionPolicy,
  ToolIsolationRequirement,
  ToolPermissionDecision,
  ToolPermissionEffect,
} from "./ToolExecutionContracts.js";
import { TOOL_NAME_PATTERN, isToolName } from "../protocol/ToolName.js";
import { captureToolApprovalIdentity } from "./ToolExecutionProtocolValidator.js";
import { captureToolExecutionPolicy } from "./ToolExecutionProtocolValidator.js";
import {
  TOOL_PERMISSION_POLICY_FAILURE,
  ToolPermissionPolicyError,
} from "./ToolPermissionPolicyErrors.js";

export type ToolPermissionRuleSource =
  | "built_in"
  | "workspace"
  | "agent_definition";

export interface ToolPermissionRuleMatch {
  readonly toolNames?: readonly string[];
  readonly toolVersions?: readonly string[];
  readonly isolation?: ToolIsolationRequirement;
}

export interface ToolPermissionRule {
  readonly ruleId: string;
  readonly source: ToolPermissionRuleSource;
  readonly effect: ToolPermissionEffect;
  readonly hardRestriction?: boolean;
  readonly match?: ToolPermissionRuleMatch;
}

export interface ToolApprovalGrant {
  readonly grantId: string;
  readonly identity: ToolApprovalIdentity;
}

export interface ToolPermissionEvaluation {
  readonly invocation: CapturedToolInvocation;
  readonly toolVersion: string;
  readonly executionPolicy: ToolExecutionPolicy;
  readonly approvalGrant?: ToolApprovalGrant;
}

export interface ToolPermissionPolicy {
  evaluate(evaluation: ToolPermissionEvaluation): ToolPermissionDecision;
}

interface CapturedPermissionRule extends ToolPermissionRule {
  readonly hardRestriction: boolean;
  readonly match: ToolPermissionRuleMatch;
  readonly sourceIndex: number;
}

const SOURCE_ORDER: Readonly<Record<ToolPermissionRuleSource, number>> = {
  built_in: 0,
  workspace: 1,
  agent_definition: 2,
};
const EFFECT_ORDER: Readonly<Record<ToolPermissionEffect, number>> = {
  allow: 0,
  ask: 1,
  deny: 2,
};
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const TOOL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RULE_FIELDS = new Set(["ruleId", "source", "effect", "hardRestriction", "match"]);
const MATCH_FIELDS = new Set(["toolNames", "toolVersions", "isolation"]);

export const INITIAL_TOOL_PERMISSION_RULES: readonly ToolPermissionRule[] =
  Object.freeze([
    Object.freeze({
      ruleId: "builtin.os_isolation_unavailable",
      source: "built_in",
      effect: "deny",
      hardRestriction: true,
      match: Object.freeze({ isolation: "os_process" }),
    }),
  ]);

export class LayeredToolPermissionPolicy implements ToolPermissionPolicy {
  readonly #rules: readonly CapturedPermissionRule[];

  constructor(rules: Iterable<ToolPermissionRule>) {
    const captured = [...rules].map((rule, sourceIndex) =>
      captureRule(rule, sourceIndex),
    );
    const ruleIds = new Set<string>();
    for (const rule of captured) {
      if (ruleIds.has(rule.ruleId)) {
        throw new ToolPermissionPolicyError(
          TOOL_PERMISSION_POLICY_FAILURE.duplicateRule,
          { ruleId: rule.ruleId },
        );
      }
      ruleIds.add(rule.ruleId);
    }
    this.#rules = Object.freeze(captured.sort(compareRules));
    Object.freeze(this);
  }

  listRules(): readonly ToolPermissionRule[] {
    return Object.freeze(
      this.#rules.map(({ sourceIndex: _sourceIndex, ...rule }) =>
        Object.freeze(rule),
      ),
    );
  }

  evaluate(evaluation: ToolPermissionEvaluation): ToolPermissionDecision {
    const input = captureEvaluation(evaluation);
    const matchedRules = this.#rules.filter((rule) => matches(rule, input));
    if (matchedRules.length === 0) {
      return freezeDecision("deny", ["builtin.default_deny"], false);
    }

    const strongestEffect = matchedRules.reduce<ToolPermissionEffect>(
      (strongest, rule) =>
        EFFECT_ORDER[rule.effect] > EFFECT_ORDER[strongest]
          ? rule.effect
          : strongest,
      "allow",
    );
    const hardRestriction = matchedRules.some(
      (rule) => rule.hardRestriction && rule.effect === "deny",
    );
    const ruleIds = matchedRules.map((rule) => rule.ruleId);

    if (strongestEffect === "deny") {
      return freezeDecision("deny", ruleIds, hardRestriction);
    }

    if (
      strongestEffect === "ask" &&
      input.approvalGrant &&
      approvalMatches(input.approvalGrant.identity, input)
    ) {
      return freezeDecision(
        "allow",
        [...ruleIds, input.approvalGrant.grantId],
        false,
      );
    }

    return freezeDecision(strongestEffect, ruleIds, false);
  }
}

function captureEvaluation(
  value: ToolPermissionEvaluation,
): ToolPermissionEvaluation {
  if (!value || typeof value !== "object") {
    throw new ToolPermissionPolicyError(
      TOOL_PERMISSION_POLICY_FAILURE.invalidEvaluation,
    );
  }
  if (!TOOL_VERSION.test(value.toolVersion)) {
    throw new ToolPermissionPolicyError(
      TOOL_PERMISSION_POLICY_FAILURE.invalidEvaluation,
      { toolName: safeToolName(value.invocation?.toolName) },
    );
  }
  captureToolApprovalIdentity({
    conversationId: value.invocation?.conversationId,
    runId: value.invocation?.runId,
    toolCallId: value.invocation?.toolCallId,
    toolName: value.invocation?.toolName,
    toolVersion: value.toolVersion,
    argumentDigest: value.invocation?.argumentDigest,
  });
  const executionPolicy = captureToolExecutionPolicy(value.executionPolicy);
  const approvalGrant = value.approvalGrant
    ? captureGrant(value.approvalGrant)
    : undefined;
  return Object.freeze({
    invocation: value.invocation,
    toolVersion: value.toolVersion,
    executionPolicy,
    ...(approvalGrant ? { approvalGrant } : {}),
  });
}

function captureGrant(value: ToolApprovalGrant): ToolApprovalGrant {
  if (!value || typeof value !== "object" || !SAFE_IDENTITY.test(value.grantId)) {
    throw new ToolPermissionPolicyError(
      TOOL_PERMISSION_POLICY_FAILURE.invalidApprovalGrant,
    );
  }
  return Object.freeze({
    grantId: value.grantId,
    identity: captureToolApprovalIdentity(value.identity),
  });
}

function captureRule(
  value: ToolPermissionRule,
  sourceIndex: number,
): CapturedPermissionRule {
  const record = asPlainRecord(value);
  const ruleId = safeIdentity(record?.ruleId);
  try {
    if (!record || hasUnknownFields(record, RULE_FIELDS)) throw new Error();
    const capturedRuleId = requireIdentity(record.ruleId);
    const source = requireOneOf(record.source, [
      "built_in",
      "workspace",
      "agent_definition",
    ] as const);
    const effect = requireOneOf(record.effect, ["allow", "ask", "deny"] as const);
    const hardRestriction = record.hardRestriction ?? false;
    if (typeof hardRestriction !== "boolean") throw new Error();
    if (hardRestriction && (source !== "built_in" || effect !== "deny")) {
      throw new Error();
    }
    return Object.freeze({
      ruleId: capturedRuleId,
      source,
      effect,
      hardRestriction,
      match: captureMatch(record.match),
      sourceIndex,
    });
  } catch {
    throw new ToolPermissionPolicyError(
      TOOL_PERMISSION_POLICY_FAILURE.invalidRule,
      { ruleId },
    );
  }
}

function captureMatch(value: unknown): ToolPermissionRuleMatch {
  if (value === undefined) return Object.freeze({});
  const record = asPlainRecord(value);
  if (!record || hasUnknownFields(record, MATCH_FIELDS)) throw new Error();
  const toolNames = captureOptionalList(record.toolNames, TOOL_NAME_PATTERN);
  const toolVersions = captureOptionalList(record.toolVersions, TOOL_VERSION);
  const isolation = record.isolation === undefined
    ? undefined
    : requireOneOf(record.isolation, ["trusted_process", "os_process"] as const);
  return Object.freeze({
    ...(toolNames ? { toolNames } : {}),
    ...(toolVersions ? { toolVersions } : {}),
    ...(isolation ? { isolation } : {}),
  });
}

function captureOptionalList(
  value: unknown,
  pattern: RegExp,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new Error();
  const captured = value.map((entry) => {
    if (typeof entry !== "string" || !pattern.test(entry)) throw new Error();
    return entry;
  });
  if (new Set(captured).size !== captured.length) throw new Error();
  return Object.freeze(captured);
}

function matches(
  rule: CapturedPermissionRule,
  evaluation: ToolPermissionEvaluation,
): boolean {
  const match = rule.match;
  return (
    (!match.toolNames || match.toolNames.includes(evaluation.invocation.toolName)) &&
    (!match.toolVersions || match.toolVersions.includes(evaluation.toolVersion)) &&
    (!match.isolation || match.isolation === evaluation.executionPolicy.isolation)
  );
}

function approvalMatches(
  identity: ToolApprovalIdentity,
  evaluation: ToolPermissionEvaluation,
): boolean {
  const invocation = evaluation.invocation;
  return (
    identity.conversationId === invocation.conversationId &&
    identity.runId === invocation.runId &&
    identity.toolCallId === invocation.toolCallId &&
    identity.toolName === invocation.toolName &&
    identity.toolVersion === evaluation.toolVersion &&
    identity.argumentDigest === invocation.argumentDigest
  );
}

function compareRules(
  left: CapturedPermissionRule,
  right: CapturedPermissionRule,
): number {
  return SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source] ||
    left.sourceIndex - right.sourceIndex;
}

function freezeDecision(
  effect: ToolPermissionEffect,
  ruleIds: readonly string[],
  hardRestriction: boolean,
): ToolPermissionDecision {
  return Object.freeze({
    effect,
    ruleIds: Object.freeze([...ruleIds]),
    hardRestriction,
  });
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return value as Record<string, unknown>;
}

function hasUnknownFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(record).some((key) => !allowed.has(key));
}

function requireIdentity(value: unknown): string {
  if (typeof value !== "string" || !SAFE_IDENTITY.test(value)) throw new Error();
  return value;
}

function safeIdentity(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_IDENTITY.test(value) ? value : undefined;
}

function safeToolName(value: unknown): string | undefined {
  return isToolName(value) ? value : undefined;
}

function requireOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error();
  return value as T[number];
}
