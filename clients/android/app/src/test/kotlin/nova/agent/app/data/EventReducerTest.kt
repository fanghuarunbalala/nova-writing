package nova.agent.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason
import nova.agent.model.LLMessage
import nova.agent.model.ToolCall

/** EventReducer 纯函数全覆盖（PRD FR13 优先项） */
class EventReducerTest {

    private fun busyState(): ChatUiState = ChatUiState(runStatus = RunStatus.Generating)

    @Test
    fun `提交于空闲态上屏用户消息并清输入`() {
        val s = ChatUiState(input = "续写第12章").reduce(ChatUiEvent.Submitted("续写第12章", ts = 100))
        val last = s.items.single() as ChatItem.UserMsg
        assertEquals("续写第12章", last.text)
        assertTrue(last.id.startsWith("u-"))
        assertEquals("", s.input)
    }

    @Test
    fun `运行中提交进幽灵队列`() {
        val s = busyState().reduce(ChatUiEvent.Submitted("排队消息", ts = 200))
        val ghost = s.items.single() as ChatItem.GhostItem
        assertEquals("排队消息", ghost.text)
        assertEquals(200L, ghost.enqueuedAt)
    }

    @Test
    fun `RunStart 晋升全部幽灵并进入思考态`() {
        var s = busyState()
            .reduce(ChatUiEvent.Submitted("第一条", ts = 1))
            .reduce(ChatUiEvent.Submitted("第二条", ts = 2))
        s = s.reduce(ChatUiEvent.RunStarted(runSeq = 3, ts = 3))
        assertEquals(listOf("第一条", "第二条"), s.items.map { (it as ChatItem.UserMsg).text })
        assertEquals(listOf("g-1", "g-2"), s.items.map { it.id }) // id 保持 → LazyColumn 锚定稳定
        assertEquals(RunStatus.Thinking, s.runStatus)
    }

    @Test
    fun `RunStart 带轮次标签时分隔线插在本轮用户消息前`() {
        var s = busyState()
            .reduce(ChatUiEvent.Submitted("排队A", ts = 1))
            .reduce(ChatUiEvent.Submitted("排队B", ts = 2))
        s = s.reduce(ChatUiEvent.RunStarted(runSeq = 4, ts = 3, roundLabel = "第 4 轮 · 续写"))
        assertEquals("r-4", s.items.first().id)
        assertEquals("第 4 轮 · 续写", (s.items.first() as ChatItem.RoundLabel).text)
        assertEquals(listOf("g-1", "g-2"), s.items.drop(1).map { it.id })
    }

    @Test
    fun `首个 delta 触发思考到生成的切换`() {
        val s = ChatUiState(runStatus = RunStatus.Thinking)
            .reduce(ChatUiEvent.DeltaArrived("扶栏的凉", ts = 1))
        assertEquals(RunStatus.Generating, s.runStatus)
        assertEquals("扶栏的凉", s.draft)
    }

    @Test
    fun `delta 累计文本幂等替换`() {
        val once = busyState().reduce(ChatUiEvent.DeltaArrived("abcdef", ts = 1))
        val twice = once.reduce(ChatUiEvent.DeltaArrived("abcdef", ts = 2))
        assertEquals(once, twice)
    }

    @Test
    fun `收口落正文块并清草稿`() {
        val s = busyState()
            .reduce(ChatUiEvent.DeltaArrived("正文", ts = 1))
            .reduce(ChatUiEvent.AssistantClosed(7, "正文全文", reasoning = "思路", ts = 2))
        assertEquals("", s.draft)
        val last = s.items.last() as ChatItem.AssistantMsg
        assertEquals("a-7", last.id)
        assertEquals("思路", last.reasoning)
        assertEquals(RunStatus.Idle, s.runStatus)
    }

    @Test
    fun `收口事件重放幂等`() {
        val once = busyState().reduce(ChatUiEvent.AssistantClosed(7, "正文", null, ts = 1))
        val twice = once.reduce(ChatUiEvent.AssistantClosed(7, "正文", null, ts = 9))
        assertEquals(once, twice)
    }

    @Test
    fun `工具行三态转换`() {
        val started = busyState().reduce(ChatUiEvent.ToolStarted("call-1", "novel_edit_outline", ts = 10))
        assertEquals(ToolPhase.Run(10), (started.items.single() as ChatItem.ToolLine).phase)

        val ok = started.reduce(ChatUiEvent.ToolFinished("call-1", "novel_edit_outline", ok = true, summary = "diff 12 行", error = null, ts = 12))
        assertEquals(ToolPhase.Ok, (ok.items.single() as ChatItem.ToolLine).phase)
        assertEquals("diff 12 行", (ok.items.single() as ChatItem.ToolLine).summary)

        val fail = started.reduce(ChatUiEvent.ToolFinished("call-1", "novel_edit_outline", ok = false, summary = "", error = "网络中断", ts = 13))
        assertEquals(ToolPhase.Fail("网络中断"), (fail.items.single() as ChatItem.ToolLine).phase)
    }

    @Test
    fun `审批征询弹出待办与系统胶囊，裁决后回填并回到生成`() {
        val approval = ApprovalUi(
            requestId = "req-1",
            cards = listOf(ApprovalCardUi("c-1", ApprovalOp.EDIT, "novel_edit_outline", "标题", "当前", "变更")),
            askedAt = 1,
        )
        var s = busyState().reduce(ChatUiEvent.ApprovalAsked(approval, ts = 2))
        assertEquals(RunStatus.WaitingApproval, s.runStatus)
        assertEquals(approval, s.pendingApproval)
        assertIs<ChatItem.SysPill>(s.items.last())

        s = s.reduce(ChatUiEvent.ApprovalSettled("req-1", approved = true, ts = 3))
        assertNull(s.pendingApproval)
        assertEquals(RunStatus.Generating, s.runStatus)
        val line = s.items.last() as ChatItem.SysLine
        assertEquals("整批决策：1 项全部批准", line.text)

        // 过期/失序的第二次裁决幂等吞掉
        val again = s.reduce(ChatUiEvent.ApprovalSettled("req-1", approved = false, ts = 999))
        assertEquals(s, again)
    }

    @Test
    fun `卡级驳回留 sysLine 且意见并入文本`() {
        val approval = ApprovalUi(
            requestId = "req-9",
            askedAt = 1,
            cards = listOf(ApprovalCardUi("c-1", ApprovalOp.EDIT, "NovelEdit", "沈砚 · 角色档案（v2 → v3）", "当前", "变更")),
        )
        var s = ChatUiState().reduce(ChatUiEvent.ApprovalAsked(approval, ts = 2))
        s = s.reduce(ChatUiEvent.ApprovalCardDecided("req-9", "c-1", approved = false, comment = "现状改动幅度太大"))
        val line = s.items.last() as ChatItem.SysLine
        assertEquals("已驳回 NovelEdit · 沈砚 · 角色档案 · 意见：现状改动幅度太大", line.text)
        assertEquals(ApprovalDecision.REJECTED, s.pendingApproval?.cards?.single()?.decision)
    }

    @Test
    fun `清空上下文落单行留痕并复位`() {
        val s = ChatUiState(
            items = listOf(ChatItem.UserMsg("u-1", "旧")),
            hasMoreOlder = true,
            olderRunsRemaining = 8,
            runStatus = RunStatus.Generating,
        ).reduce(ChatUiEvent.ContextCleared)
        val line = s.items.single() as ChatItem.SysLine
        assertTrue(line.text.startsWith("已清空上下文"))
        assertEquals(false, s.hasMoreOlder)
        assertEquals(0, s.olderRunsRemaining)
        assertEquals(RunStatus.Idle, s.runStatus)
    }

    @Test
    fun `超时全批过期留痕并关弹层`() {
        val approval = ApprovalUi(
            requestId = "req-t",
            askedAt = 1,
            cards = listOf(
                ApprovalCardUi("c-1", ApprovalOp.EDIT, "NovelEdit", "标题（v2 → v3）", "当前", "变更"),
                ApprovalCardUi("c-2", ApprovalOp.ADD, "NovelWrite", "标题二", null, "变更"),
            ),
        )
        var s = ChatUiState().reduce(ChatUiEvent.ApprovalAsked(approval, ts = 2))
        s = s.reduce(ChatUiEvent.ApprovalTimedOut("req-t", ts = 3))
        assertNull(s.pendingApproval)
        val line = s.items.last() as ChatItem.SysLine
        assertEquals("审批超时 · 本批 2 项自动拒绝（120s）——AI 将收到拒绝回执并继续", line.text)
        // repo 侧随后的 resolve（ApprovalResolved）被幂等吞掉
        val again = s.reduce(ChatUiEvent.ApprovalSettled("req-t", approved = false, ts = 999))
        assertEquals(s, again)
    }

    @Test
    fun `超时速演缩短 deadline`() {
        val approval = ApprovalUi(
            requestId = "req-s",
            askedAt = 1,
            cards = listOf(ApprovalCardUi("c-1", ApprovalOp.EDIT, "t", "题", "cur", "chg")),
        )
        var s = ChatUiState().reduce(ChatUiEvent.ApprovalAsked(approval, ts = 2))
        s = s.reduce(ChatUiEvent.ApprovalDeadlineShortened("req-s", 6_000, ts = 100))
        assertEquals(6_000L, s.pendingApproval?.deadlineMs)
        assertEquals(100L, s.pendingApproval?.askedAt)
    }

    @Test
    fun `离线排队态提交走幽灵`() {
        var s = ChatUiState().reduce(ChatUiEvent.OfflineQueueToggled(true))
        assertTrue(s.offlineQueued)
        s = s.reduce(ChatUiEvent.Submitted("排队消息", ts = 1))
        assertIs<ChatItem.GhostItem>(s.items.single())
    }

    @Test
    fun `RunClosed 五态映射`() {
        assertEquals(RunStatus.Idle, busyState().reduce(ChatUiEvent.RunClosed(RunEndReason.COMPLETED, null, 1)).runStatus)
        assertEquals(RunStatus.Idle, busyState().reduce(ChatUiEvent.RunClosed(RunEndReason.ABORTED, null, 1)).runStatus)
        assertEquals(RunStatus.FailedRetry, busyState().reduce(ChatUiEvent.RunClosed(RunEndReason.FAILED, "provider 500", 1)).runStatus)
    }

    @Test
    fun `历史用户消息按 runSeq 幂等去重`() {
        val once = ChatUiState().reduce(ChatUiEvent.UserEchoed(3, "历史", ts = 1))
        val twice = once.reduce(ChatUiEvent.UserEchoed(3, "历史", ts = 2))
        assertEquals(once, twice)
        assertEquals("u-r3", once.items.single().id)
    }

    @Test
    fun `loadOlder 前插并更新 hasMore`() {
        val older = listOf(ChatItem.UserMsg("h-0-u", "旧"), ChatItem.AssistantMsg("h-0-a", "旧答"))
        val s = ChatUiState(items = listOf(ChatItem.UserMsg("u-1", "新")))
            .reduce(ChatUiEvent.OlderLoaded(older, hasMore = false, remaining = 0))
        assertEquals(listOf("h-0-u", "h-0-a", "u-1"), s.items.map { it.id })
        assertEquals(false, s.hasMoreOlder)
        assertEquals(0, s.olderRunsRemaining)
    }

    @Test
    fun `推理折叠与输入及模式`() {
        var s = ChatUiState(input = "x").reduce(ChatUiEvent.AssistantClosed(1, "t", "r", 1))
        s = s.reduce(ChatUiEvent.ReasoningToggled("a-1"))
        assertTrue((s.items.single() as ChatItem.AssistantMsg).reasoningExpanded)

        s = s.reduce(ChatUiEvent.InputChanged("新输入")).reduce(ChatUiEvent.ExecModeChanged(ExecMode.DISCUSS))
        assertEquals("新输入", s.input)
        // 切换只挂「待生效」（demo pendModeChip），不立即生效
        assertEquals(ExecMode.NEED_APPROVAL, s.execMode)
        assertEquals(ExecMode.DISCUSS, s.pendingExecMode)

        s = s.reduce(ChatUiEvent.Submitted("下一条", ts = 2))
        assertEquals(ExecMode.DISCUSS, s.execMode)
        assertEquals(null, s.pendingExecMode)
    }

    @Test
    fun `只读租约观察`() {
        val lease = ReadOnlyLease("d-2", "MacBook Pro 14", expiresAt = 9, seq = 42)
        val s = ChatUiState().reduce(ChatUiEvent.LeaseObserved(lease))
        assertEquals(lease, s.lease)
        assertEquals(null, s.reduce(ChatUiEvent.LeaseObserved(null)).lease)
    }
}

/** LoopEvent → ChatUiEvent 映射（含审批 arguments 载荷解析） */
class LoopEventMappingTest {

    private val now = { 4321L }

    @Test
    fun `基本事件映射`() {
        assertIs<ChatUiEvent.RunStarted>(mapLoopEvent(LoopEvent.RunStart("c", 1), now))
        assertIs<ChatUiEvent.DeltaArrived>(mapLoopEvent(LoopEvent.AssistantDelta("c", 1, "累计"), now))
        val closed = mapLoopEvent(
            LoopEvent.AssistantMessage("c", 1, LLMessage.Assistant(content = "全文", reasoning = "思路")),
            now,
        ) as ChatUiEvent.AssistantClosed
        assertEquals("全文", closed.text)
        assertEquals("思路", closed.reasoning)

        val resp = mapLoopEvent(
            LoopEvent.ToolCallResponse("c", 1, toolCallId = "t1", name = "n", content = "ok", error = null),
            now,
        ) as ChatUiEvent.ToolFinished
        assertTrue(resp.ok)
    }

    @Test
    fun `审批载荷解析三型卡片`() {
        val calls = listOf(
            ToolCall("e1", "novel_edit_outline", """{"op":"edit","title":"改","current":"旧","change":"新"}"""),
            ToolCall("a1", "novel_add_location", """{"op":"add","title":"增","change":"内容"}"""),
            ToolCall("d1", "novel_remove_character", """{"op":"delete","title":"删","current":"有","change":"理由"}"""),
        )
        val asked = mapLoopEvent(LoopEvent.ApprovalRequested("c", 1, "req", calls), now) as ChatUiEvent.ApprovalAsked
        val (edit, add, delete) = asked.approval.cards
        assertEquals(ApprovalOp.EDIT, edit.op)
        assertEquals("旧", edit.current)
        assertEquals(ApprovalOp.ADD, add.op)
        assertNull(add.current)
        assertEquals(ApprovalOp.DELETE, delete.op)
        assertEquals("c-e1", edit.id)
    }

    @Test
    fun `审批载荷解析键值行与版本过期`() {
        val call = ToolCall(
            "e9", "NovelEdit",
            """{"op":"edit","title":"沈砚 · 角色档案（v2 → v3）","current":"旧","change":"x",""" +
                """"changeRows":[{"k":"现状","v":"火漆印"}],"currentRows":[{"k":"名称","v":"废弃渡口碑"}],"stale":["v2","v3"],"origin":"桌面端 · dev_mb14"}""",
        )
        val asked = mapLoopEvent(LoopEvent.ApprovalRequested("c", 1, "req", listOf(call)), now) as ChatUiEvent.ApprovalAsked
        val card = asked.approval.cards.single()
        assertEquals(listOf("现状" to "火漆印"), card.changeRows)
        assertEquals(listOf("名称" to "废弃渡口碑"), card.currentRows)
        assertEquals("v2", card.baseVersion)
        assertEquals("v3", card.staleVersion)
        assertEquals("桌面端 · dev_mb14", card.originChip)
    }

    @Test
    fun `载荷解析失败回落保守占位`() {
        val asked = mapLoopEvent(
            LoopEvent.ApprovalRequested("c", 1, "req", listOf(ToolCall("x", "any", "不是json"))),
            now,
        ) as ChatUiEvent.ApprovalAsked
        assertEquals(ApprovalOp.EDIT, asked.approval.cards.single().op)
        assertEquals("更新既有内容", asked.approval.cards.single().title)
    }

    @Test
    fun `Compacted 不映射`() {
        assertEquals(null, mapLoopEvent(LoopEvent.Compacted("c", 1, "policy"), now))
    }
}
