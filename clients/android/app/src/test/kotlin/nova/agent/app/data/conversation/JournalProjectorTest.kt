package nova.agent.app.data.conversation

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.put
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class JournalProjectorTest {

    @Test
    fun completedRunProjectsFullLifecycle() {
        val run = StoredRun(1).apply {
            append(listOf(LLMessage.User("续写第一章")))
            append(listOf(LLMessage.Assistant(content = "雪落了满肩。", finishReason = FinishReason.STOP)))
        }
        val events = JournalProjector.runEvents("c1", run)

        assertEquals(4, events.size)
        assertIs<LoopEvent.RunStart>(events[0])
        val user = assertIs<LoopEvent.UserMessage>(events[1])
        assertEquals("续写第一章", user.content)
        assertIs<LoopEvent.AssistantMessage>(events[2])
        val end = assertIs<LoopEvent.RunEnd>(events[3])
        assertEquals(RunEndReason.COMPLETED, end.reason)
        assertEquals("雪落了满肩。", end.finalContent)
    }

    @Test
    fun toolRunProjectsRowsWithoutRunEndWhileHanging() {
        val call = nova.agent.model.ToolCall("t-1", "novel_write_paragraph", "{}")
        val run = StoredRun(2).apply {
            append(listOf(LLMessage.User("改一下")))
            append(listOf(LLMessage.Assistant(content = "改这段", toolCalls = listOf(call), finishReason = FinishReason.TOOL_CALL)))
            // 无 tool 回填 = 他端 run 进行中
        }
        val events = JournalProjector.runEvents("c1", run)
        assertTrue(events.none { it is LoopEvent.RunEnd }, "悬挂 run 不合成 RunEnd（只读端呈生成中）")
        assertTrue(events.any { it is LoopEvent.ToolCallRequest })
    }

    @Test
    fun rowEventsDistinguishSnapshotAndAppend() {
        val call = nova.agent.model.ToolCall("t-2", "novel_read_outline")
        val snapshot = JournalProjector.rowEvents(
            "c1", 3, "snapshot",
            listOf(LLMessage.User("看大纲"), LLMessage.Assistant(toolCalls = listOf(call), finishReason = FinishReason.TOOL_CALL)),
        )
        assertTrue(snapshot.first() is LoopEvent.RunStart)
        assertEquals(4, snapshot.size, "RunStart + User + Assistant + ToolCallRequest")

        val append = JournalProjector.rowEvents("c1", 3, "append", listOf(LLMessage.Tool("t-2", "novel_read_outline", "（暂无段落）")))
        assertEquals(1, append.size)
        assertIs<LoopEvent.ToolCallResponse>(append[0])
    }

    @Test
    fun parseMessagesHandlesArrayAndDoubleEncodedString() {
        val direct = kotlinx.serialization.json.buildJsonArray {
            add(kotlinx.serialization.json.buildJsonObject { put("type", "user"); put("content", "hi") })
            add(kotlinx.serialization.json.buildJsonObject { put("type", "assistant"); put("content", "ok") })
        }
        assertEquals(2, JournalProjector.parseMessages(direct).size)

        val doubleEncoded = JsonPrimitive(direct.toString())
        assertEquals(2, JournalProjector.parseMessages(doubleEncoded).size)

        val garbage: kotlinx.serialization.json.JsonElement = JsonPrimitive("not-json")
        val parsed = JournalProjector.parseMessages(garbage)
        assertEquals(0, parsed.size)
    }
}