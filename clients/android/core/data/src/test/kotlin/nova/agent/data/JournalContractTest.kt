package nova.agent.data

import kotlinx.coroutines.test.runTest
import nova.agent.data.room.RoomJournalStore
import nova.agent.journal.JournalStore
import nova.agent.journal.JsonlJournalStore
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.model.ToolCall
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 契约测试：JSONL 与 Room 两个 JournalStore 实现跑同一套断言——
 * 这是「双实现同契约」的验收方式（PRD §6）。
 */
class JournalContractTest {

    private fun jsonlStore(): JournalStore {
        val dir = Files.createTempDirectory("nova-contract")
        return JsonlJournalStore(dir.resolve("journal.jsonl"))
    }

    private fun roomStore(): JournalStore = RoomJournalStore.inMemory().second

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

        // rewriteAll 全量重写（模拟 T1 压缩）→ 重放一致
        val mutated = runs.toMutableList()
        mutated[0] = StoredRun(1, mutableListOf(LLMessage.User("…[T1骨架化]")))
        store.rewriteAll(mutated)
        runs = store.readAll()
        assertEquals(2, runs.size)
        assertEquals("…[T1骨架化]", (runs[0].messages[0] as LLMessage.User).content)
        assertEquals(4, runs[1].messages.size)

        // 摘要标记跨重启幂等：内容级 <context-summary> 恢复 summarized
        mutated[0] = StoredRun(1, mutableListOf(LLMessage.User("<context-summary run=\"1\">\n摘要内容\n</context-summary>")))
        store.rewriteAll(mutated)
        runs = store.readAll()
        assertTrue(runs[0].summarized)
        assertTrue(!runs[1].summarized)

        // open 幂等 + 续号单调：重放后再追加，run2 消息数 +1
        val appended = store.appendMessages(2, listOf(LLMessage.Assistant("恢复后追加")))
        assertTrue(appended.seq > 0)
        assertEquals(5, store.readAll()[1].messages.size)
    }

    @Test
    fun jsonlSatisfiesContract() = runTest { contract(jsonlStore()) }

    @Test
    fun roomSatisfiesContract() = runTest { contract(roomStore()) }

    @Test
    fun recoveryWorksOnBothStores() = runTest {
        foreach@ for (store in listOf(jsonlStore(), roomStore())) {
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
                    // c1 缺 tool 结果 —— 崩溃现场
                ),
            )
            val runs = store.readAll().toMutableList()
            val settled = nova.agent.journal.Recovery.settlePendingRun(store, runs)
            assertEquals(1, settled.size)
            assertTrue(nova.agent.journal.Recovery.findPendingToolCalls(store.readAll()).isEmpty())
        }
    }
}
