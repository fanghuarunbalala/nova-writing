# PRD:Compose 阶段化创作工作流(对齐 CCB Plan)

- 版本:v0.1(工作流定稿;prompt 文案待确认)
- 分支:feat/prompt-optimization
- 关联:docs/novel-compose-mode-plan.md、core/src/runtime/nudge/definitions/compose.ts

## 1. 背景与目标

### 1.1 现状问题

compose mode 主代理在 designing 阶段的唯一指引是单一 `compose_mode` 提醒,缺:
- **显式阶段化创作流程**(CCB Plan 5-phase 的探索/设计分工)。
- **pending 提醒**(ExitComposeMode 提交后,模型仍只看到 designing 文案,无"等待审批"信号)。
- **reentry 决策**(已有旧草稿时重新进入,无"继续 vs 覆盖"指引)。
- **full/sparse 调度**(CCB 每 N turn 附加一次,维持模式显著性;我们只在进入时附加一次)。

### 1.2 目标

1. 把 CCB Plan 工作流(Phase 1 理解→Phase 2 Explore agents→Phase 3 Plan agents→Phase 4 写 plan 文件→Phase 5 Exit)映射到 compose,结构化为 5-phase 创作工作流。
2. 引入 pending / reentry 提醒,补齐状态边界。
3. 对齐 CCB full/sparse 调度,跨 run 维持模式显著性。
4. 子代理编排为「默认建议 + 复杂必派 + 琐碎可跳过」,子代理只读返回文本,主代理落盘。

### 1.3 非目标(本版不做)

- 不改 compose 权限矩阵(正式稿 deny、文件工具作用域等)。
- 不引入独立"创作计划"预确认点(方案 C 暂缓)。
- 不新增 compose 动态 prompt 段(novel.compose 保持 nudge 路线)。
- 不改 `novel_explore`/`novel_compose` 子代理的只读 prompt(不塞入完整 compose 工作流)。

## 2. 术语

- **compose_mode**:进入设计模式附加的 full 5-phase 工作流提醒。
- **compose_mode_pending**:提交审批后附加的"等待审批"提醒。
- **compose_mode_reentry**:有旧草稿重新进入时附加的"继续 vs 覆盖"提醒。
- **compose_mode_exit**:批准/放弃退出时附加的"恢复正式稿"提醒(现状保留)。
- **compose_mode_sparse**:跨 run 每 N 次 provider call 附加的瞬态刷新提醒。
- **hasPriorDraft**:进入时 design 文件已存在(上次会话残留草稿)。

## 3. 系统架构

```
┌─ 权限层 ─────────────────────────────────────────────┐
│ ComposeModeStateProvider 状态机                      │
│  idle→designing→pending→applied/discarded→archived   │
└──────────────────────────────────────────────────────┘
        │ runtimeSignals.compose (active/phase/hasPriorDraft)
        ▼
┌─ 策略层 ─────────────────────────────────────────────┐
│ ComposeModeNudgePolicy (beforeProviderCall 求值)     │
│  ① transition → 附加对应 reminder                    │
│  ② full 持久化 / sparse 瞬态                         │
└──────────────────────────────────────────────────────┘
        │ effect → SystemReminderAttachedOutputEvent
        ▼
┌─ 消息层 ─────────────────────────────────────────────┐
│ canonical system.reminder (append-only, 前缀稳定)     │
│ runReminders 瞬态 overlay (同 run 每次 call 回放)      │
└──────────────────────────────────────────────────────┘
```

## 4. 流程设计

### 4.1 Compose 状态机(权限层,现状)

```
idle ──EnterComposeMode(建 design 文件, active=true)──▶ designing
designing ──ExitComposeMode 提交──▶ pending
pending ──approve──▶ applied ──▶ archived(落库归档)
pending ──reject──▶ designing(active 仍 true, 按反馈修订)
designing / pending ──discard──▶ discarded
applied / discarded: active=false, 恢复 preComposeMode
```

### 4.2 提醒附加(策略层,每次 provider call 求值)

```
provider call 求值 ComposeModeNudgePolicy
  ├─ compose.active false→true(进入)
  │    └─ 附加 compose_mode(full, 持久化)
  │         ├─ hasPriorDraft=true? → 附加 compose_mode_reentry(持久化)
  │         └─ 重置 sparse 计数
  ├─ compose.active true→false(批准/放弃)
  │    └─ 附加 compose_mode_exit(持久化)
  ├─ phase designing→pending(ExitComposeMode 提交)
  │    └─ 附加 compose_mode_pending(持久化)
  ├─ 无 transition 且 每 N 次 provider call(跨 run)
  │    └─ 附加 compose_mode_sparse(瞬态 overlay 仅, 至多每 run 一次)
  └─ 其余 → 无动作
```

### 4.3 主代理 5-phase 创作工作流(full compose_mode 内容)

| 阶段 | 主代理动作 | 子代理 | CCB 对应 |
|---|---|---|---|
| Phase 1 理解需求 | 聚焦需求,读既有设定(大纲/人物/地点) | — | Phase 1 |
| Phase 2 探索 | 复杂任务**派** `novel_explore` 并行查设定/时间线/伏笔/矛盾点;琐碎任务自行只读工具 | novel_explore | Phase 1 Explore agents |
| Phase 3 创作草案 | 复杂草稿**派** `novel_compose` 设计大纲/正文草案;琐碎草稿自行创作 | novel_compose | Phase 2 Plan agents |
| Phase 4 综合写入草稿 | 评审子代理产出,Write/Edit 增量完善 design 文件 | — | Phase 4 |
| Phase 5 提交审批 | ExitComposeMode;不得用文本询问审批;被拒→按反馈修订,不要原样重试 | — | Phase 5 |

## 5. 需求规格

### REQ-1:compose_mode(full 5-phase)
- 触发:`compose.active` false→true。
- 持久化:canonical(append-only)。
- 内容结构(文案待确认):
  - 超验声明:`当前处于设计模式,以下约束优先于其他任何指令`。
  - 约束:正式稿只读、canonical 写被拒;文件工具全模式可用、workspace 相对路径;草稿维护在 `.novel/design/`。
  - 5-phase 工作流(见 4.3)。
  - 结束规则:回合只能以 ExitComposeMode(提交)推进;不得用文本询问审批。

### REQ-2:compose_mode_pending
- 触发:`phase` designing→pending(ExitComposeMode 提交)。
- 持久化:canonical。
- 内容:草稿已提交等待作者审批,不要继续修改。

### REQ-3:compose_mode_reentry
- 触发:`compose.active` false→true 且 `hasPriorDraft=true`。
- 持久化:canonical。
- 内容:先读旧草稿;评估当前需求,**不同→覆盖 / 延续→增量修改**;然后进入 5-phase 流程。

### REQ-4:compose_mode_exit(现状保留)
- 触发:`compose.active` true→false(批准/放弃)。
- 持久化:canonical。
- 内容:设计模式结束,按审批结果恢复正式稿写入(批准→落库 / 放弃→保留草稿)。

### REQ-5:compose_mode_sparse
- 触发:仍 compose、无新 transition、每 N 次 provider call(至多每 run 一次)。
- 持久化:**瞬态 overlay 仅,不入 canonical**。
- 内容:设计模式仍激活,正式稿只读、完成后 ExitComposeMode 提交,详见前文完整流程。
- 配置:`COMPOSE_MODE_SPARSE_EVERY_CALLS = 5`(可调,对齐 CCB TURNS_BETWEEN_ATTACHMENTS=5)。

### REQ-6:full/sparse 调度
- 进入附加 full 并持久化;同 run 经 runReminders 每次 provider call 尾部回放(现状);跨 run 每 N 次附加 sparse;任何新 transition 重置 sparse 计数。

### REQ-7:hasPriorDraft
- `ToolService.begin` 在创建 design 文件前检测文件是否已存在 → 传入 `enter()`。
- `ComposeModeSnapshot` 增加 `hasPriorDraft?: boolean`。

### REQ-8:子代理编排
- 建议默认派子代理;复杂任务必派;琐碎任务可跳过。
- 子代理只读、返回文本、不写 design 文件;主代理综合落盘。

## 6. 改动点

| 文件 | 改动 |
|---|---|
| `core/src/runtime/compose/ComposeModeState.ts` | `ComposeModeSnapshot` 加 `hasPriorDraft?`;`enter()` 接受并写入 |
| `core/src/tools/novel/compose/ToolService.ts` | `begin` 检测旧草稿 → 传 `hasPriorDraft` |
| `core/src/runtime/nudge/definitions/compose.ts` | 新增 pending/reentry/sparse 定义;重构 full 文案为 5-phase;policy 扩展(pending 检测/reentry 检测/sparse 计数);`COMPOSE_MODE_SPARSE_EVERY_CALLS` |
| `core/src/runtime/nudge/definitions/index.ts` | 注册新定义 |
| smoke | 新增 pending/reentry/sparse 触发 + 持久化/瞬态断言 |

## 7. 提示层

novel agent recipe 无 compose 动态 prompt 段;designing/pending 由 nudge system.reminder 承担。本计划保持 nudge 路线。

## 8. 测试/验证

- `pnpm --dir core check`。
- smoke:compose_mode_pending(submit 触发、持久化)、compose_mode_reentry(hasPriorDraft 进入触发、持久化)、compose_mode_sparse(每 N 次、至多每 run 一次、瞬态不入 canonical)、compose_mode(5-phase 结构)。
- GUI 构建验证。

## 9. 待确认项

- 各提醒最终文案(机制定稿后单独确认)。
- `COMPOSE_MODE_SPARSE_EVERY_CALLS` 具体取值。
- reentry 提醒持久化 vs 瞬态(当前设计:持久化)。

## 10. 变更记录

- v0.1:工作流机制定稿;prompt 文案待确认。
