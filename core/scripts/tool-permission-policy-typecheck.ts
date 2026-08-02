/** Compile-only proof that permission rules and decisions remain immutable. */
import type {
  ToolPermissionDecision,
  ToolPermissionRule,
} from "../src/tools/index.js";

declare const rule: ToolPermissionRule;
declare const decision: ToolPermissionDecision;

// @ts-expect-error Permission rules are immutable configuration snapshots.
rule.effect = "allow";
// @ts-expect-error Decision traces cannot be mutated by callers.
decision.ruleIds.push("agent.changed");
