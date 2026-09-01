package nova.agent

import kotlinx.coroutines.test.runTest
import nova.agent.journal.JsonlJournalStore
import nova.agent.journal.Recovery
import nova.agent.model.FinishReason
import nova.agent.model.JournalLine
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.model.ToolCall
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class JournalRecoveryTest {

    @Test
    fun appendAndReplayRebuildsRuns() = runTest {
        val dir = Files.createTempDirectory("nova-j")
        val journal = JsonlJournalStore(dir.resolve("journal.jsonl"))
        journal.open()

        journal.appendSnapshot(1, listOf(LLMessage.User("第一条")))
        journal.appendMessages(1, listOf(LLMessage.Assistant("回答一", finishReason = FinishReason.STOP)))
        journal.appendSnapshot(2, listOf(LLMessage.User("第二条")))
        journal.appendMessages(
            2,
            listOf(
                LLMessage.Assistant(
                    "我调工具",
                    toolCalls = listOf(ToolCall("c1", "novel_read_outline")),
                    finishReason = FinishReason.TOOL_CALL,
                ),
                LLMessage.Tool("c1", "novel_read_outline", "（该范围暂无段落）"),
                LLMessage.Assistant("回答二", finishReason = FinishReason.STOP),
            ),
        )

        val runs = journal.readAll()
        assertEquals(2, runs.size)
        assertEquals(2, runs[0].messages.size)
        assertEquals(4, runs[1].messages.size)
        assertEquals("回答一", (runs[0].messages[1] as LLMessage.Assistant).content)
        journal.close()
    }

    @Test
    fun tornLastLineTolerated() = runTest {
        val dir = Files.createTempDirectory("nova-j")
        val file = dir.resolve("journal.jsonl")
        val good = JournalLine.Snapshot(1, 1, listOf(LLMessage.User("完好行")))
        val json = kotlinx.serialization.json.Json { encodeDefaults = true }
        Files.writeString(
            file,
            json.encodeToString(JournalLine.serializer(), good) + "\n" +
                "{\"type\":\"append\",\"seq\":2,\"runSeq\":1,\"messages\":[{\"type\":\"assist", // 写到一半崩溃
        )

        val journal = JsonlJournalStore(file)
        journal.open()
        val runs = journal.readAll()
        assertEquals(1, runs.size)
        assertEquals(1, runs[0].messages.size)
        // lastSeq 只统计完好行，续写从 2 开始
        val appended = journal.appendMessages(1, listOf(LLMessage.Assistant("恢复后追加")))
        assertEquals(2, appended.seq)
    }

    @Test
    fun rewriteAllIsAtomicFullOverwrite() = runTest {
        val dir = Files.createTempDirectory("nova-j")
        val file = dir.resolve("journal.jsonl")
        val journal = JsonlJournalStore(file)
        journal.open()
        journal.appendSnapshot(1, listOf(LLMessage.User("a"), LLMessage.Assistant("长内容".repeat(100))))
        journal.appendSnapshot(2, listOf(LLMessage.User("b")))

        val runs = journal.readAll().toMutableList()
        // 模拟 T1 压缩：清空第一个 run 内容
        runs[0].messages.clear()
        runs[0].messages.add(LLMessage.User("…[T1骨架化]"))
        journal.rewriteAll(runs)

        val replayed = journal.readAll()
        assertEquals(2, replayed.size)
        assertEquals(1, replayed[0].messages.size)
        assertEquals("…[T1骨架化]", (replayed[0].messages[0] as LLMessage.User).content)
        // 旧内容已被全量重写挤掉，文件里不再有
        assertTrue(!Files.readString(file).contains("长内容"))
    }

    @Test
    fun findPendingToolCallsAndSettle() = runTest {
        val dir = Files.createTempDirectory("nova-j")
        val journal = JsonlJournalStore(dir.resolve("journal.jsonl"))
        journal.open()
        // 崩溃现场：assistant 发起两个工具调用，只回填了一个
        journal.appendSnapshot(1, listOf(LLMessage.User("续写")))
        journal.appendMessages(
            1,
            listOf(
                LLMessage.Assistant(
                    "调用",
                    toolCalls = listOf(ToolCall("c1", "novel_read_outline"), ToolCall("c2", "novel_write_paragraph")),
                    finishReason = FinishReason.TOOL_CALL,
                ),
                LLMessage.Tool("c1", "novel_read_outline", "结果"),
                // c2 缺失 —— 进程在这里被杀
            ),
        )

        val runs = journal.readAll().toMutableList()
        val pending = Recovery.findPendingToolCalls(runs)
        assertEquals(listOf("c2"), pending.map { it.id })

        val settled = Recovery.settlePendingRun(journal, runs)
        assertEquals(1, settled.size)
        assertEquals("c2", settled[0].toolCallId)
        assertTrue(settled[0].content.contains("未执行"))

        // 补完后：重放无悬挂，模型下轮可继续
        val replayed = journal.readAll()
        assertTrue(Recovery.findPendingToolCalls(replayed).isEmpty())
        assertEquals(4, replayed[0].messages.size)
    }
}
