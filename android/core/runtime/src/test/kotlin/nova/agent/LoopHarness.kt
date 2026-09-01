package nova.agent

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import nova.agent.approval.ApprovalGate
import nova.agent.approval.ApprovalRequest
import nova.agent.compact.CompactionConfig
import nova.agent.compact.CompactPolicyChain
import nova.agent.compact.defaultPolicies
import nova.agent.journal.JsonlJournalStore
import nova.agent.loop.AgentLoop
import nova.agent.loop.AgentLoopConfig
import nova.agent.loop.LoopEvent
import nova.agent.provider.FakeProvider
import nova.agent.tool.ToolDef
import nova.agent.tool.ToolDispatcher
import nova.agent.tool.ToolRegistry
import nova.agent.tool.novel.InMemoryNovelStore
import nova.agent.tool.novel.novelTools
import java.nio.file.Files

/** 单测装配：默认 approvalBypass + 内存小说库 + 临时目录 journal。 */
class LoopHarness(
    vararg scripted: FakeProvider.ScriptedTurn,
    val approvalTimeoutMs: Long = 120_000,
    val loopConfig: AgentLoopConfig = AgentLoopConfig(approvalBypass = true),
    val compactionConfig: CompactionConfig = CompactionConfig(),
    customTools: List<ToolDef>? = null,
    val onRequest: suspend (ApprovalRequest) -> Unit = {},
    val clock: () -> Long = { 0L },
    ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    val provider = FakeProvider().apply { scripted.forEach { enqueue(it) } }
    val store = InMemoryNovelStore()
    val journalDir = Files.createTempDirectory("nova-journal")
    val journal = JsonlJournalStore(journalDir.resolve("journal.jsonl"), io = ioDispatcher)
    val gate = ApprovalGate(timeoutMs = approvalTimeoutMs, onRequest = onRequest)
    val events = MutableSharedFlow<LoopEvent>(extraBufferCapacity = 512)
    val chain = CompactPolicyChain(journal, compactionConfig, defaultPolicies(compactionConfig))
    private val registry = ToolRegistry().apply {
        (customTools ?: novelTools(store)).forEach { register(it) }
    }
    private val dispatcher = ToolDispatcher(registry)

    fun loop(): AgentLoop = AgentLoop(
        conversationId = "c-test",
        provider = provider,
        dispatcher = dispatcher,
        journal = journal,
        approvalGate = gate,
        chain = chain,
        events = events,
        systemPrompt = { "你是测试助手" },
        config = loopConfig,
        clock = clock,
    )

    fun journalText(): String =
        Files.readString(journalDir.resolve("journal.jsonl"))
}
