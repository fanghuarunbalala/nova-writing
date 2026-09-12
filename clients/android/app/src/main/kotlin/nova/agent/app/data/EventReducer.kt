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
        copy(items = items + item, input = "", lastSubmitted = event.text, localId = nextId)
    }

    is ChatUiEvent.RunStarted -> {
        // 幽灵晋升：排队消息全部转为正式用户消息（顺序保持），随后进入 Thinking
        val promoted = items.map { item ->
            if (item is ChatItem.GhostItem) ChatItem.UserMsg(item.id, item.text) else item
        }
        copy(items = promoted, runStatus = RunStatus.Thinking, draft = "", runStartedAt = event.ts)
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
        val pill = ChatItem.SysPill("s-${event.approval.requestId}", "审批请求 · ${event.approval.cards.size} 项变更待确认", PillKind.WARN)
        val merged = if (items.any { it.id == pill.id }) items else items + pill
        copy(items = merged, pendingApproval = event.approval, runStatus = RunStatus.WaitingApproval)
    }

    is ChatUiEvent.ApprovalSettled -> {
        if (pendingApproval?.requestId != event.requestId && pendingApproval != null) {
            // 过期/失序的裁决（如超时自动驳回后本地又到一次）——幂等吞掉
            this
        } else {
            val pill = ChatItem.SysPill(
                "s-${event.requestId}-done",
                if (event.approved) "已批准 · 工具继续执行" else "已驳回 · 附意见",
                if (event.approved) PillKind.SUCCESS else PillKind.DANGER,
            )
            val merged = if (items.any { it.id == pill.id }) items else items + pill
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
        else copy(
            pendingApproval = pa.copy(
                cards = pa.cards.map { card ->
                    if (card.id == event.cardId && card.decision == ApprovalDecision.PENDING) {
                        card.copy(decision = if (event.approved) ApprovalDecision.APPROVED else ApprovalDecision.REJECTED)
                    } else card
                },
            ),
        )
    }

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
        copy(items = event.prepend + items, hasMoreOlder = event.hasMore)

    is ChatUiEvent.InputChanged -> copy(input = event.text)

    is ChatUiEvent.ExecModeChanged -> copy(execMode = event.mode)

    is ChatUiEvent.LeaseObserved -> copy(lease = event.lease)

    is ChatUiEvent.SysPillAdded -> {
        val nextId = localId + 1
        copy(items = items + ChatItem.SysPill("sp-$nextId", event.text, event.kind), localId = nextId)
    }

    ChatUiEvent.ConversationReset -> ChatUiState()

    is ChatUiEvent.ReasoningToggled -> copy(items = items.map { item ->
        if (item.id == event.itemId && item is ChatItem.AssistantMsg) {
            item.copy(reasoningExpanded = !item.reasoningExpanded)
        } else item
    })
}
