package nova.agent.demo

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import nova.agent.approval.ApprovalDecision
import nova.agent.approval.ApprovalGate
import nova.agent.approval.ApprovalRequest
import nova.agent.journal.JsonlJournalStore
import nova.agent.loop.AgentLoopConfig
import nova.agent.loop.LoopEvent
import nova.agent.provider.FakeProvider
import nova.agent.session.AgentSession
import nova.agent.tool.novel.InMemoryNovelStore
import nova.agent.tool.novel.novelTools
import java.nio.file.Files
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * 端到端演示（不触网，脚本化假模型）：
 *
 *   ./gradlew :core:runtime:runDemo   或   java -jar … DemoMain
 *
 * 场景编排：
 * 1. 「续写第 12 章」：模型流式输出（控制台打字机）→ 调 novel_read_outline 读大纲
 *    → 提案 novel_write_paragraph（进审批门）→ 控制台批准 → 落库收口；
 * 2. 第二条消息运行中「崩溃」（模拟 LMK 杀进程）；
 * 3. 重开会话：journal 重放恢复现场 + 悬挂工具调用补完 → 问用户续跑/停止。
 */
fun main() = runBlocking {
    val dir = Files.createTempDirectory("nova-demo")
    val journalPath = dir.resolve("journal.jsonl")
    val store = InMemoryNovelStore()
    store.write("p-1", "su-12", 1, "第十一章结尾：林深把信塞进袖口，头也不回地出了城。", baseRevision = null)

    fun buildProvider() = FakeProvider().apply {
        // run 1：读大纲 → 提案写段落 → 收口
        enqueue(
            FakeProvider.ScriptedTurn(
                deltas = listOf("让我先", "看看现有大纲", "的走向。"),
                toolCalls = listOf(FakeProvider.toolCall("c1", "novel_read_outline")),
            ),
            FakeProvider.ScriptedTurn(
                deltas = listOf("基于第十一章的收束，", "我提议续写：", "雪夜追凶。"),
                toolCalls = listOf(
                    FakeProvider.toolCall(
                        "c2", "novel_write_paragraph",
                        """{"id":"p-2","storyUnitId":"su-12","orderKey":2,"text":"雪下了一夜。林深在城外的破庙里数着马蹄声，第三声之后，门开了。","baseRevision":1}""",
                    )
                ),
            ),
            FakeProvider.ScriptedTurn(deltas = listOf("提案已提交，等待审批。")),
        )
        // run 2：会在这条消息流式途中被「杀进程」
        enqueue(
            FakeProvider.ScriptedTurn(
                deltas = listOf("第十二回", "：雪满", "孤城道。"),
                delayMs = 400,
            ),
            FakeProvider.ScriptedTurn(deltas = listOf("（本 run 不会到达）")),
        )
    }

    // ---- 场景 1+2：正常审批 run，然后中途「崩溃」 ----
    val provider = buildProvider()
    val requests = ArrayList<ApprovalRequest>()
    val gate = ApprovalGate(timeoutMs = 120_000) { req ->
        requests.add(req)
        log("📩", "审批征询 ${req.requestId}：${req.calls.joinToString { it.name }}")
    }
    val journal = JsonlJournalStore(journalPath)
    val session = AgentSession(
        conversationId = "demo-12",
        provider = provider,
        tools = novelTools(store),
        journal = journal,
        approvalGate = gate,
        loopConfig = AgentLoopConfig(approvalBypass = false),
        dispatcher = Dispatchers.Default,
    )
    val ui = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    ui.launch {
        session.events.collect { e -> render(e) }
    }
    // 模拟用户：审批请求到达后 1 秒批准
    ui.launch {
        while (true) {
            delay(1_000)
            requests.removeLastOrNull()?.let {
                log("✅", "用户批准 ${it.requestId}")
                session.approvalGate.resolve(it.requestId, ApprovalDecision.Approve)
            }
        }
    }

    session.start()
    session.submit("续写第12章")
    // 等 run 1 完成（轮询状态，demo 简化处理）
    waitDone(session, 1)
    session.submit("再写一段")
    delay(1_000) // run 2 流式中
    log("💥", "进程被 LMK 杀死（模拟）")
    session.shutdown()
    ui.cancel()

    // ---- 场景 3：重开 App，重放恢复 ----
    log("🔁", "用户重新打开 App")
    val journal2 = JsonlJournalStore(journalPath)
    val session2 = AgentSession(
        conversationId = "demo-12",
        provider = FakeProvider(), // 不再发新消息，run 2 的剩余脚本不会消费
        tools = novelTools(store),
        journal = journal2,
        loopConfig = AgentLoopConfig(approvalBypass = true),
        dispatcher = Dispatchers.Default,
    )
    session2.start()
    val history = session2.history()
    log("📖", "重放恢复 ${history.size} 个 run：")
    history.forEach { r ->
        val last = r.messages.lastOrNull()
        log("   ", "run ${r.runSeq}: ${r.messages.size} 条消息，收口于 ${last?.let { it::class.simpleName }}")
    }
    session2.shutdown()
    log("🎬", "演示结束。journal 文件：$journalPath")
}

private suspend fun waitDone(session: AgentSession, runSeq: Int) {
    var waited = 0
    while (waited < 30_000) {
        val st = session.state.value
        if (st is nova.agent.session.SessionState.Done && st.runSeq == runSeq) return
        delay(100)
        waited += 100
    }
}

private fun render(e: LoopEvent) {
    when (e) {
        is LoopEvent.RunStart -> log("▶️ ", "run ${e.runSeq} 开始")
        is LoopEvent.UserMessage -> log("👤", e.content)
        is LoopEvent.AssistantDelta -> print("\r  ✍️  ${e.textSoFar}")
        is LoopEvent.AssistantMessage -> println()
        is LoopEvent.ToolCallRequest -> log("🔧", "调用 ${e.call.name}(${e.call.arguments.take(60)}…)")
        is LoopEvent.ToolCallResponse ->
            if (e.error != null) log("⚠️ ", "${e.name}: ${e.error}") else log("📄", "${e.name}: ${e.content?.take(60)}")
        is LoopEvent.ApprovalRequested -> {}
        is LoopEvent.ApprovalResolved -> log("⚖️ ", "审批决议 ${e.decision}${e.comment?.let { "：$it" } ?: ""}")
        is LoopEvent.RunEnd -> log("🏁", "run ${e.runSeq} ${e.reason}${e.finalContent?.let { " → ${it.take(40)}" } ?: ""}")
        else -> {}
    }
}

private fun log(tag: String, message: String) {
    val ts = LocalDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss.SSS"))
    println("[$ts] $tag $message")
}
