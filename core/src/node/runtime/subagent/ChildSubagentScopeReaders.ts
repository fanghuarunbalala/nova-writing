/**
 * Child 组合根生产用子代理作用域 reader：父作用域与工具策略关系。
 * Production subagent scope readers for the child composition root: the parent
 * scope (the running Novel conversation) and the tool-policy reduction check.
 */
import type { ConversationRuntimeBootstrap } from "../../../conversation/index.js";
import type { SubagentRequest } from "../../../runtime/subagent/index.js";
import {
  NOVEL_AGENT_TOOL_POLICY_ID,
  NOVEL_COMPOSE_TOOL_POLICY_ID,
  NOVEL_EXPLORER_TOOL_POLICY_ID,
  SUBAGENT_TOOL_POLICY_RELATION,
  type SubagentParentScope,
  type SubagentParentScopeReader,
  type SubagentToolPolicyRelation,
  type SubagentToolPolicyRelationReader,
} from "../../../runtime/subagent/index.js";

/** 子代理作用域 reader 组合。Combined subagent scope readers for the child root. */
export interface ChildSubagentScopeReaders {
  readonly parentScopeReader: SubagentParentScopeReader;
  readonly toolPolicyRelationReader: SubagentToolPolicyRelationReader;
}

/**
 * 基于当前 child Runtime bootstrap 构建生产作用域 reader。
 * Builds production scope readers from the child Runtime bootstrap.
 *
 * 父作用域是当前运行的 Novel 会话：depth 0、workspaceId 取 bootstrap、
 * 工具策略 id 固定为 novel agent 的策略 id。
 * The parent scope is the currently running Novel conversation: depth 0, the
 * workspace id from the bootstrap, and the fixed Novel agent tool policy id.
 */
export function createChildSubagentScopeReaders(
  bootstrap: ConversationRuntimeBootstrap,
): ChildSubagentScopeReaders {
  const parentScopeReader: SubagentParentScopeReader = {
    async readParentScope(
      request: SubagentRequest,
    ): Promise<SubagentParentScope> {
      return Object.freeze({
        parentConversationId: request.parentConversationId,
        parentRunId: request.parentRunId,
        workspaceId: bootstrap.workspace.workspaceId,
        depth: 0,
        toolPolicyId: NOVEL_AGENT_TOOL_POLICY_ID,
      });
    },
  };
  const toolPolicyRelationReader: SubagentToolPolicyRelationReader = {
    async readRelation(
      parentToolPolicyId: string,
      childToolPolicyId: string,
    ): Promise<SubagentToolPolicyRelation> {
      if (
        childToolPolicyId === NOVEL_EXPLORER_TOOL_POLICY_ID ||
        childToolPolicyId === NOVEL_COMPOSE_TOOL_POLICY_ID
      ) {
        return SUBAGENT_TOOL_POLICY_RELATION.reduced;
      }
      if (parentToolPolicyId === childToolPolicyId) {
        return SUBAGENT_TOOL_POLICY_RELATION.same;
      }
      return SUBAGENT_TOOL_POLICY_RELATION.unknown;
    },
  };
  return Object.freeze({ parentScopeReader, toolPolicyRelationReader });
}
