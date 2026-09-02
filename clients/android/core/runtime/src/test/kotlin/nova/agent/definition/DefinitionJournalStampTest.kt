package nova.agent.definition

import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import nova.agent.LoopHarness
import nova.agent.loop.AgentLoop
import nova.agent.model.StoredRun
import nova.agent.provider.FakeProvider
import nova.agent.tool.ToolDispatcher
import nova.agent.tool.ToolRegistry
import nova.agent.tool.novel.novelTools
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** definitionVersion 溯源：run 开号的 snapshot 行携带定义包版本，重放还原。 */
class DefinitionJournalStampTest {

    @Test
    fun definitionVersionStampedAndReplayed() = runTest {
        val h = LoopHarness(
            FakeProvider.ScriptedTurn(deltas = listOf("完成")),
            clock = { currentTime },
        )
        h.journal.open()
        val registry = ToolRegistry().apply { novelTools(h.store).forEach { register(it) } }
        val loop = AgentLoop(
            conversationId = "c-def",
            provider = h.provider,
            dispatcher = ToolDispatcher(registry),
            journal = h.journal,
            approvalGate = h.gate,
            chain = h.chain,
            events = h.events,
            systemPrompt = { "sys" },
            clock = { currentTime },
            definitionVersion = "1.5.0",
        )

        loop.executeRun(1, "续写", mutableListOf())

        // 落盘行携带版本
        assertTrue(h.journalText().contains("\"definitionVersion\":\"1.5.0\""))
        // 重放还原到 StoredRun
        val replayed: StoredRun = h.journal.readAll().first()
        assertEquals("1.5.0", replayed.definitionVersion)
    }
}
