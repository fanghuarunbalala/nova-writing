package nova.agent.app.data.conversation

import nova.agent.app.data.ChatItem
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** run 粒度分页 fold（FR4：latest/before/limit+1 探测）。 */
class PaginationFoldTest {

    private fun run(seq: Int) = StoredRun(seq).apply {
        append(listOf(LLMessage.User("消息$seq"), LLMessage.Assistant(content = "回答$seq", finishReason = FinishReason.STOP)))
    }

    @Test
    fun twentyRunsPageThroughWithHasMoreBoundaries() {
        val paging = HistoryPaging(pageSize = 8)
        val history = (1..20).map { run(it) }

        val first = paging.nextPage(history, "c1")!!
        assertEquals(8, first.prepend.count { it is ChatItem.UserMsg }, "每 run 一条用户消息")
        assertTrue(first.hasMore)

        val second = paging.nextPage(history, "c1")!!
        assertEquals(8, second.prepend.count { it is ChatItem.UserMsg })
        assertTrue(second.hasMore)

        val third = paging.nextPage(history, "c1")!!
        assertEquals(4, third.prepend.count { it is ChatItem.UserMsg }, "20 - 8 - 8 = 4")
        assertTrue(!third.hasMore)

        assertNull(paging.nextPage(history, "c1"), "耗尽后返回 null")
    }

    @Test
    fun pagesAreOldestFirstAndIdsIdempotentWithLivePath() {
        val paging = HistoryPaging(pageSize = 2)
        val history = listOf(run(5), run(6), run(7))

        val page = paging.nextPage(history, "c1")!!
        // 首屏取最新 2 run（6,7），页内升序展示（OlderLoaded 前插时间线正确）
        val userItems = page.prepend.filterIsInstance<ChatItem.UserMsg>()
        assertEquals(listOf("消息6", "消息7"), userItems.map { it.text })
        // id 与实时 UserEchoed 路径同构（u-r<runSeq>，防重复上屏）
        assertEquals(listOf("u-r6", "u-r7"), userItems.map { it.id })
        assertIs<ChatItem.AssistantMsg>(page.prepend.last())
    }

    @Test
    fun fewerThanPageSizeMeansNoMore() {
        val paging = HistoryPaging(pageSize = 8)
        val page = paging.nextPage(listOf(run(1), run(2)), "c1")!!
        assertEquals(2, page.prepend.count { it is ChatItem.UserMsg })
        assertTrue(!page.hasMore)
        assertNull(paging.nextPage(listOf(run(1), run(2)), "c1"))
    }
}
