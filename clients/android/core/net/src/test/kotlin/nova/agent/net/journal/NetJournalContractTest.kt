package nova.agent.net.journal

import kotlinx.coroutines.test.runTest
import nova.agent.data.room.RoomJournalStore
import nova.agent.journal.JsonlJournalStore
import nova.agent.journal.JournalStore
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.model.ToolCall
import nova.agent.net.http.ServerHttp
import nova.agent.net.support.FakeLedgerServer
import nova.agent.net.support.InMemoryPendingQueue
import nova.agent.net.support.fixedAuthSession
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 三实现契约套件（PRD FR11）：Http vs Jsonl vs Room 跑同一套断言——
 * 对齐 data 模块 JournalContractTest 的「工厂 + 共享 contract() + 每实现一个 @Test」模式。
 */
class NetJournalContractTest {

    private var fake: FakeLedgerServer? = null

    private fun jsonlStore(): JournalStore {
        val dir = Files.createTempDirectory("nova-net-contract")
        return JsonlJournalStore(dir.resolve("journal.jsonl"))
    }

    private fun roomStore(): JournalStore = RoomJournalStore.inMemory().second

    private fun httpStore(): JournalStore {
        val f = FakeLedgerServer()
        fake = f
        return HttpJournalStore(
            http = f.http(),
            conversationId = "c1",
            auth = fixedAuthSession(f.baseUrl),
            getLeaseToken = { "lease-contract" },
            pending = InMemoryPendingQueue(),
        )
    }

    @AfterTest
    fun tearDown() {
        fake?.close()
    }

    private suspend fun contract(store: JournalStore) {
        store.open()

        // 追加 + 重放
        store.appendSnapshot(1, listOf(LLMessage.User("第一条")))
        store.appendMessages(1, listOf(LLMessage.Assistant("回答一", finishReason = FinishReason.STOP)))
        store.appendSnapshot(2, listOf(LLMessage.User("第二条")))
        store.appendMessages(
            2,
            listOf(
                LLMessage.Assistant(
                    "调工具",
                    toolCalls = listOf(ToolCall("c1", "novel_write_paragraph", "{}")),
                    finishReason = FinishReason.TOOL_CALL,
                ),
                LLMessage.Tool("c1", "novel_write_paragraph", "已写入段落 p-1（v1）"),
                LLMessage.Assistant("完成", finishReason = FinishReason.STOP),
            ),
        )
        var runs = store.readAll()
        assertEquals(2, runs.size)
        assertEquals(2, runs[0].messages.size)
        assertEquals(4, runs[1].messages.size)
        assertEquals("已写入段落 p-1（v1）", (runs[1].messages[2] as LLMessage.Tool).content)

        // rewriteAll 全量重写 → 重放一致
        val mutated = runs.toMutableList()
        mutated[0] = StoredRun(1, mutableListOf(LLMessage.User("…[T1骨架化]")))
        store.rewriteAll(mutated)
        runs = store.readAll()
        assertEquals(2, runs.size)
        assertEquals("…[T1骨架化]", (runs[0].messages[0] as LLMessage.User).content)
        assertEquals(4, runs[1].messages.size)

        // 摘要标记跨重启幂等
        mutated[0] = StoredRun(1, mutableListOf(LLMessage.User("<context-summary run=\"1\">\n摘要\n</context-summary>")))
        store.rewriteAll(mutated)
        runs = store.readAll()
        assertTrue(runs[0].summarized)
        assertTrue(!runs[1].summarized)

        // open 幂等 + 续号单调
        store.open()
        val appended = store.appendMessages(2, listOf(LLMessage.Assistant("恢复后追加")))
        assertTrue(appended.seq > 0)
        assertEquals(5, store.readAll()[1].messages.size)
    }

    @Test
    fun jsonlSatisfiesContract() = runTest { contract(jsonlStore()) }

    @Test
    fun roomSatisfiesContract() = runTest { contract(roomStore()) }

    @Test
    fun httpSatisfiesContract() = runTest { contract(httpStore()) }

    @Test
    fun recoveryWorksOnAllThreeStores() = runTest {
        for (store in listOf(jsonlStore(), roomStore(), httpStore())) {
            store.open()
            store.appendSnapshot(1, listOf(LLMessage.User("续写")))
            store.appendMessages(
                1,
                listOf(
                    LLMessage.Assistant(
                        "调用",
                        toolCalls = listOf(ToolCall("c1", "novel_read_outline")),
                        finishReason = FinishReason.TOOL_CALL,
                    ),
                    // c1 缺 tool 结果——崩溃现场
                ),
            )
            val runs = store.readAll().toMutableList()
            val settled = nova.agent.journal.Recovery.settlePendingRun(store, runs)
            assertEquals(1, settled.size)
            assertTrue(nova.agent.journal.Recovery.findPendingToolCalls(store.readAll()).isEmpty())
        }
    }

    @Test
    fun roomPendingPushQueueRespectsOrderAndLimit() = runTest {
        val (db, _) = RoomJournalStore.inMemory()
        val queue = RoomPendingPushQueue(db.pendingPushDao(), maxRows = 3)
        queue.enqueue("c1", "snapshot", 1, "[]")
        queue.enqueue("c1", "snapshot", 2, "[]")
        queue.enqueue("c1", "append", 2, "[]")
        queue.enqueue("c9", "append", 1, "[]") // 其他会话不占 c1 配额
        assertEquals(3, queue.count("c1"))
        assertEquals(1, queue.count("c9"))

        val drained = queue.drainAll("c1")
        assertEquals(3, drained.size)
        assertEquals("snapshot", drained[0].kind)
        assertTrue(drained[0].id < drained[1].id && drained[1].id < drained[2].id) // id 序 = 入队序

        queue.removeSent(drained.take(2).map { it.id })
        assertEquals(1, queue.drainAll("c1").size)

        try {
            queue.enqueue("c1", "append", 9, "[]") // 已有 1 行,再加会超 3
            queue.enqueue("c1", "append", 9, "[]")
            queue.enqueue("c1", "append", 9, "[]")
            org.junit.jupiter.api.Assertions.fail<PendingPushOverflowException>("应抛溢出")
        } catch (e: PendingPushOverflowException) {
            assertEquals(3, e.limit)
        }
    }
}
