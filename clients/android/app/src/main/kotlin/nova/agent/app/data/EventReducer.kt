package nova.agent.app.data

import nova.agent.loop.RunEndReason

/**
 * 纯函数 reducer：ChatUiState × ChatUiEvent → ChatUiState。
 * 全部时间来自事件 ts，无隐藏时钟 → JVM 可确定性测试。
 *
 * 思考启发式（M4 已知限制，PRD FR7.3）：RunStart 后到首个 AssistantDelta 之前视为 Thinking；
 * 运行时推理瞬时 delta 不上事件流（只在收口随 AssistantMessage 落 journal），无法感知真实思考流。
 */
fun ChatUiState.reduce(event: ChatUiEvent): ChatUiState = when (event) {
    is ChatUiEvent.Submitted -> {
        val nextId = localId + 1
        val item: ChatItem = if (isBusy) {
            ChatItem.GhostItem("g-$nextId", event.text, event.ts)
        } else {
            ChatItem.UserMsg("u-$nextId", event.text)
        }
        // 待生效执行模式随本条消息落地（demo applyModeIfPending）
        val mode = pendingExecMode ?: execMode
        copy(
            items = items + item, input = "", lastSubmitted = event.text, localId = nextId,
            execMode = mode, pendingExecMode = null,
        )
    }

    is ChatUiEvent.RunStarted -> {
        // 幽灵晋升：排队消息全部转为正式用户消息（顺序保持），随后进入 Thinking；
        // 带轮次标签时，分隔线插在本轮首条用户消息（原幽灵）之前
        val promoted = items.map { item ->
            if (item is ChatItem.GhostItem) ChatItem.UserMsg(item.id, item.text) else item
        }
        val withLabel = event.roundLabel?.let { label ->
            val firstGhost = items.indexOfFirst { it is ChatItem.GhostItem }
            val roundLabel = ChatItem.RoundLabel("r-${event.runSeq}", label)
            if (firstGhost >= 0) promoted.take(firstGhost) + roundLabel + promoted.drop(firstGhost)
            else promoted + roundLabel
        } ?: promoted
        copy(items = withLabel, runStatus = RunStatus.Thinking, draft = "", runStartedAt = event.ts)
    }

    is ChatUiEvent.DeltaArrived -> {
        // 累计文本幂等替换；Thinking→Generating 切换点
        val status = if (runStatus == RunStatus.Thinking) RunStatus.Generating else runStatus
        copy(draft = event.textSoFar, runStatus = status)
    }

    is ChatUiEvent.AssistantClosed -> {
        val id = "a-${event.runSeq}"
        if (items.any { it.id == id }) {
            copy(draft = "")
        } else {
            copy(
                items = items + ChatItem.AssistantMsg(id, event.text, event.reasoning),
                draft = "",
                runStatus = if (runStatus == RunStatus.Generating || runStatus == RunStatus.Thinking) RunStatus.Idle else runStatus,
            )
        }
    }

    is ChatUiEvent.ToolStarted -> {
        val id = "t-${event.callId}"
        if (items.any { it.id == id }) this
        else copy(items = items + ChatItem.ToolLine(id, event.name, ToolPhase.Run(event.ts)))
    }

    is ChatUiEvent.ToolFinished -> {
        val id = "t-${event.callId}"
        val phase = if (event.ok) ToolPhase.Ok else ToolPhase.Fail(event.error ?: "失败")
        val updated = items.map { item ->
            if (item.id == id) (item as ChatItem.ToolLine).copy(phase = phase, summary = event.summary) else item
        }
        // 防御：响应先于请求到达（不发生，但保持可回放鲁棒）
        if (updated == items && items.none { it.id == id }) {
            copy(items = items + ChatItem.ToolLine(id, event.name, phase, event.summary))
        } else {
            copy(items = updated)
        }
    }

    is ChatUiEvent.ApprovalAsked -> {
        // demo sysPill 文案（L1219）：「角色写入 · 沈砚 等 3 项待审批 —— 点击查看」
        val first = event.approval.cards.firstOrNull()?.title?.substringBefore(" · ") ?: "变更"
        val pill = ChatItem.SysPill(
            "s-${event.approval.requestId}",
            "角色写入 · $first 等 ${event.approval.cards.size} 项待审批 —— 点击查看",
            PillKind.WARN,
        )
        val merged = if (items.any { it.id == pill.id }) items else items + pill
        copy(items = merged, pendingApproval = event.approval, runStatus = RunStatus.WaitingApproval)
    }

    is ChatUiEvent.ApprovalSettled -> {
        if (pendingApproval?.requestId != event.requestId && pendingApproval != null) {
            // 过期/失序的裁决（如超时自动驳回后本地又到一次）——幂等吞掉
            this
        } else {
            // demo sysLine（L2314）：整批决策单行 mono 留痕
            val count = pendingApproval?.cards?.size ?: 0
            val line = ChatItem.SysLine(
                "l-${event.requestId}",
                if (event.approved) "整批决策：$count 项全部批准" else "整批决策：$count 项全部驳回",
            )
            val merged = if (items.any { it.id == line.id }) items else items + line
            copy(
                items = merged,
                pendingApproval = null,
                runStatus = if (runStatus == RunStatus.WaitingApproval) RunStatus.Generating else runStatus,
            )
        }
    }

    is ChatUiEvent.ApprovalCardDecided -> {
        val pa = pendingApproval ?: return this
        if (pa.requestId != event.requestId) this
        else {
            val card = pa.cards.firstOrNull { it.id == event.cardId && it.decision == ApprovalDecision.PENDING }
                ?: return this
            // demo 只给逐项「驳回」留 sysLine（L2292）；批准仅卡内盖章
            val line = if (event.approved) null else ChatItem.SysLine(
                "l-${event.cardId}",
                buildString {
                    append("已驳回 ${card.toolName} · ${card.title.substringBefore("（")}")
                    if (!event.comment.isNullOrBlank()) append(" · 意见：${event.comment}")
                },
            )
            val merged = line?.let { if (items.any { l -> l.id == it.id }) items else items + it } ?: items
            copy(
                items = merged,
                pendingApproval = pa.copy(
                    cards = pa.cards.map { c ->
                        if (c.id == card.id) c.copy(decision = if (event.approved) ApprovalDecision.APPROVED else ApprovalDecision.REJECTED) else c
                    },
                ),
            )
        }
    }

    is ChatUiEvent.ContextCleared -> copy(
        items = listOf(ChatItem.SysLine("l-clear", "已清空上下文 · 新一轮开始——此前档案与正文保留")),
        draft = "",
        hasMoreOlder = false,
        olderRunsRemaining = 0,
        runStatus = RunStatus.Idle,
        runStartedAt = null,
    )

    is ChatUiEvent.RunClosed -> when (event.reason) {
        RunEndReason.COMPLETED, RunEndReason.ABORTED, RunEndReason.MAX_TURNS ->
            copy(runStatus = RunStatus.Idle, draft = "", runStartedAt = null)
        RunEndReason.FAILED ->
            copy(runStatus = RunStatus.FailedRetry, draft = "", runStartedAt = null)
    }

    is ChatUiEvent.UserEchoed -> {
        val id = "u-r${event.runSeq}"
        if (items.any { it.id == id }) this
        else copy(items = items + ChatItem.UserMsg(id, event.text))
    }

    is ChatUiEvent.OlderLoaded ->
        copy(items = event.prepend + items, hasMoreOlder = event.hasMore, olderRunsRemaining = event.remaining)

    is ChatUiEvent.InputChanged -> copy(input = event.text)

    // 切换只挂「待生效」（demo pendModeChip）；实际生效点在 Submitted
    is ChatUiEvent.ExecModeChanged -> copy(pendingExecMode = event.mode)

    is ChatUiEvent.LeaseObserved -> copy(lease = event.lease)

    is ChatUiEvent.ReasoningToggled -> copy(items = items.map { item ->
        if (item.id == event.itemId && item is ChatItem.AssistantMsg) {
            item.copy(reasoningExpanded = !item.reasoningExpanded)
        } else item
    })
}
