# PRD：审批跨重启续回（Approval Resume Across Restart）

日期：2026-08-10
分支：`refactor/log-system`（基于最新 main `52889bd`）
状态：需求已确认，实现分阶段

## 1. 背景 / 问题

作者审批写入时，GUI / 子运行时重启，该审批**永久卡在「等待审批」**，批准无效、前端不消除。

根因：审批请求持久化在会话 journal（`tool.approval.requested` 输出事件），但审批决策由内存协调器（`InMemoryInteractionCoordinator`）处理，重启后 `#pending` 清空；后续决策返回 `unknownRequest`，不发 `tool.approval.resolved` → 前端 `ToolApprovalInteractionProjector` 永不清除。

## 2. 目标

重启后，挂起审批**保持有效可批准**；批准后**工具重新执行、变更落库、agent 继续回应**。不丢失在途变更。

## 3. 用户故事

- 作为作者，等待审批时重启应用，回来后该审批仍在，批准后改动正常生效、对话继续。
- 作为作者，若续回失败（审批已过期等），看到明确「已过期」状态而非卡死。
- 作为作者，拒绝后变更不落库，agent 收到拒绝并继续。

## 4. 行为流程（目标态）

> **关键语义**：审批挂起是一个特殊状态——「断开重连（disconnect/reconnect）」。进程死亡重启后，该状态被**续回（resume）**，**复用同一 pending 审批，不新发起请求**。`continue` 重入是把这条被中断的执行续上，而非产生新的 tool 调用 / 新的审批。

1. Agent 调工具需审批 → `tool.approval.requested` 持久化 → run 进入 `waiting_interaction`（记录 approvalRequestId/toolCallId）→ 前端显示「等待审批」。
2. **重启（断开）**。
3. 启动恢复：检测 run 处 `waiting_interaction` 且审批仍 pending → **不标 failed**、**不新发起审批** → 恢复协调器 pending + `continue` 重入 agent 流（复用同一 approvalRequestId/toolCallId）。
4. 用户「批准」→ 协调器匹配 → 同一工具重新执行 → 变更落库 → `tool.approval.resolved(approved)` → agent 续跑回复。
5. 用户「拒绝」→ 变更不落库 → `resolved(rejected)` → agent 收到拒绝继续。

## 5. 验收标准

- AC1：审批挂起 → 重启 → 审批仍显示 pending。
- AC2：批准 → 工具执行、变更落库、agent 续跑回复。
- AC3：拒绝 → 变更不落库，agent 收到拒绝继续。
- AC4：审批已过期 → 显示「已过期」，不卡死。
- AC5：普通中断 run（非审批挂起）恢复行为不变（failed）。
- AC6：多 pending 审批续回正确，无重复 resolved。

## 6. 范围 / 非目标

- **范围**：审批 pause 点的续回——run 状态机持久化 `waiting_interaction`、启动恢复协调器、`continue` 重入 agent。
- **非目标**：全部 run 执行栈恢复；agent 中途断点续传（`continue` 从历史重跑即可）；跨进程 / workspace 级审批流。

## 7. 技术要点

- **`waiting_interaction` 是「断开重连」特殊状态**：进程死亡重启后续回，**复用同一 approvalRequestId/toolCallId**，`continue` 重入不产生新请求。
- `RunStateMachine` 启用 `waiting_interaction` 转换（已定义未触发），`RunStateSnapshot` 增 `interaction { approvalRequestId, toolCallId }`。
- 工具审批挂起点 → run 状态迁移（running ↔ waiting_interaction）。
- 启动投影审批 → `InMemoryInteractionCoordinator.restore` 恢复 `#pending`（同一 pending）。
- 恢复分支对 `waiting_interaction` run 用 `continue` 重入：历史含 tool_calls → 工具桥**重派同一工具** → 协调器匹配同一 pending → await → 批准后执行 → agent 续跑。
- 续回失败回退现有 failed 恢复 + 兜底 expired。

## 8. 内存与泄漏风险（关键）

- **现状**：审批挂起时，run 的 agent 流 + 工具派发栈 + 协调器 `#pending` 全部驻留内存（`ToolDispatcher.#authorize` await `request()` 阻塞整条流）。
- **泄漏风险**：`coordinator.expire()` 已定义但**无人调用**——无过期清扫。无人应答/放弃的审批会**永久占住该 run 内存**；且 `#resolveDecision` 不检查 `expiresAt`，过期后仍可批准。
- **必须修复（纳入本 PRD）**：
  1. **过期清扫**：子运行时加周期定时器调 `coordinator.expire(now)` → 过期审批结算为 `expired` → `request()` 解绕 → run 失败释放内存（兜底）。这是**必要修复**，防止内存泄漏。
  2. **release-and-resume（续回持久化的目标形态）**：审批挂起时**持久化 `waiting_interaction` + 解绕 run 的内存执行**，决策后再 `continue` 续回——等待期不占内存。这是方案 2 的理想形态；若改动过大，先用「过期清扫」兜底泄漏，release-and-resume 作为后续优化。

## 9. 风险与分阶段

- 风险：core 恢复架构改动，agent 流重入，需充分 smoke；`continue` 从历史重跑的工具重派一致性；过期清扫与续回的竞态。
- 阶段 0（**泄漏兜底，先行**）：过期清扫——周期 `coordinator.expire(now)`，释放无应答审批占用的 run 内存。
- 阶段 1（最小可跑）：waiting_interaction 主路径 + 恢复协调器 + continue 重入 + 场景 A/B。
- 阶段 2（加固）：续回失败兜底（回退 + expired）、多 pending 并发、幂等 / 竞态；release-and-resume（暂停解绕 + 决策续回）。

## 附录：关键代码位置

- `core/src/runtime/execution/state/RunStateMachine.ts`（waiting_interaction 转换 :161-169；RunStateSnapshot :23-30）
- `core/src/runtime/tools/execution/ToolDispatcher.ts`（#authorize :404）
- `core/src/runtime/interaction/InMemoryInteractionCoordinator.ts`（restore :228）
- `core/src/runtime/execution/startup/RuntimeStartupExecutor.ts`（recoverOrphanedLifecycle :377-416）
- `core/src/runtime/agent/pi/PiAgentCoreAdapter.ts`（continue :843）
- `core/src/runtime/execution/agent/AgentRuntimeRunExecutor.ts`（continue 校验 :481）
