package nova.agent.net.journal

import kotlinx.coroutines.test.runTest
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.model.ToolCall
import nova.agent.net.http.ServerApiException
import nova.agent.net.support.FakeLedgerServer
import nova.agent.net.support.InMemoryPendingQueue
import nova.agent.net.support.fixedAuthSession
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

class HttpJournalStoreTest {

    private lateinit var fake: FakeLedgerServer
    private lateinit var pending: InMemoryPendingQueue
    private var lease: String? = "lease-1"

    @BeforeTest
    fun setUp() {
        fake = FakeLedgerServer()
        pending = InMemoryPendingQueue()
    }

    @AfterTest
    fun tearDown() {
        fake.close()
    }

    private fun store(mirror: java.nio.file.Path? = null) = HttpJournalStore(
        http = fake.http(),
        conversationId = "c1",
        auth = fixedAuthSession(fake.baseUrl),
        getLeaseToken = { lease },
        pending = pending,
        mirrorPath = mirror,
    )

    @Test
    fun appendPostsExpectedFields() = runTest {
        val s = store()
        s.open()
        val line = s.appendSnapshot(1, listOf(LLMessage.User("第一条")), definitionVersion = "1.0.0")
        assertTrue(line.seq > 0)

        assertEquals("GET", fake.server.takeRequest().method) // open() 对账 replay
        val recorded = fake.server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/v1/runs/c1/events", recorded.path)
        assertEquals("Bearer tok-fixed", recorded.getHeader("Authorization"))
        val body = recorded.body.readUtf8()
        assertTrue(body.contains(""""runSeq":1"""))
        assertTrue(body.contains(""""kind":"snapshot""""))
        assertTrue(body.contains(""""definitionVersion":"1.0.0""""))
        assertTrue(body.contains(""""leaseToken":"lease-1""""))
        assertTrue(body.contains(""""content":"第一条""""))
    }

    @Test
    fun readAllFoldsReplayWithDoubleParsedPayload() = runTest {
        val s = store()
        s.open()
        s.appendSnapshot(1, listOf(LLMessage.User("问")))
        s.appendMessages(
            1,
            listOf(
                LLMessage.Assistant("调工具", toolCalls = listOf(ToolCall("c1", "novel_write_paragraph")), finishReason = FinishReason.TOOL_CALL),
                LLMessage.Tool("c1", "novel_write_paragraph", "已写入段落 p-1（v1）"),
                LLMessage.Assistant("完成", finishReason = FinishReason.STOP),
            ),
        )
        val runs = s.readAll()
        assertEquals(1, runs.size)
        assertEquals(4, runs[0].messages.size)
        assertEquals("已写入段落 p-1（v1）", (runs[0].messages[2] as LLMessage.Tool).content)
    }

    @Test
    fun offlineAppendEnqueuesWithoutThrowAndDrainsInOrderOnOpen() = runTest {
        val s = store()
        s.open()
        fake.offline = true
        // 网络失败：入队不抛（PRD 3.4：run 不中断），返回本地行
        val l1 = s.appendSnapshot(1, listOf(LLMessage.User("离线1")))
        val l2 = s.appendMessages(1, listOf(LLMessage.Assistant("离线回复")))
        assertTrue(l1.seq < l2.seq)
        assertEquals(2, pending.count("c1"))
        assertEquals(0, fake.rowCount) // server 未收到

        fake.offline = false
        s.open() // 对账 + 按序补推
        assertEquals(0, pending.count("c1"))
        assertEquals(2, fake.rowCount)
        val runs = s.readAll()
        assertEquals(2, runs[0].messages.size)
    }

    @Test
    fun pendingOverflowThrows() = runTest {
        val small = InMemoryPendingQueue(maxRows = 2)
        val s = HttpJournalStore(
            fake.http(), "c1", fixedAuthSession(fake.baseUrl),
            { lease }, small,
        )
        s.open()
        fake.offline = true
        s.appendSnapshot(1, listOf(LLMessage.User("a")))
        s.appendMessages(1, listOf(LLMessage.Assistant("b")))
        try {
            s.appendMessages(1, listOf(LLMessage.Assistant("c")))
            fail("应抛 PendingPushOverflowException")
        } catch (e: PendingPushOverflowException) {
            assertEquals(2, e.limit)
        }
    }

    @Test
    fun missingLeaseThrowsWithoutEnqueue() = runTest {
        lease = null
        val s = store()
        s.open()
        try {
            s.appendSnapshot(1, listOf(LLMessage.User("x")))
            fail("应抛 lease_required")
        } catch (e: ServerApiException) {
            assertEquals("lease_required", e.code)
        }
        assertEquals(0, pending.count("c1"))
    }

    @Test
    fun rewriteConflictCarriesCurrentLastSeq() = runTest {
        val mine = store()
        mine.open()
        mine.appendSnapshot(1, listOf(LLMessage.User("我方写入"))) // serverLastSeq=1

        // 他端（第二个 store 实例）并发写入 → 账本 maxSeq=2
        val other = store()
        other.open()
        other.appendSnapshot(1, listOf(LLMessage.User("他方写入")))

        try {
            mine.rewriteAll(listOf(StoredRun(1, mutableListOf(LLMessage.User("压缩后")))))
            fail("应抛 JournalRewriteConflictException")
        } catch (e: JournalRewriteConflictException) {
            assertEquals(2, e.currentLastSeq)
        }
    }

    @Test
    fun rewriteAllReplacesServerLedgerAndReadsBack() = runTest {
        val s = store()
        s.open()
        s.appendSnapshot(1, listOf(LLMessage.User("旧1")))
        s.appendSnapshot(2, listOf(LLMessage.User("旧2")))
        s.rewriteAll(
            listOf(
                StoredRun(1, mutableListOf(LLMessage.User("…[T1骨架化]"))),
                StoredRun(2, mutableListOf(LLMessage.User("旧2"))),
            )
        )
        val runs = s.readAll()
        assertEquals(2, runs.size)
        assertEquals("…[T1骨架化]", (runs[0].messages[0] as LLMessage.User).content)
    }

    @Test
    fun mirrorWriteThroughAndShrinkRebuild() = runTest {
        val dir = Files.createTempDirectory("nova-mirror-test")
        val mirror = dir.resolve("journal.jsonl")
        val s = store(mirror = mirror)
        s.open()
        s.appendSnapshot(1, listOf(LLMessage.User("落镜像")))
        // 写通：POST 成功后按响应 gs 落行
        val rows = nova.agent.net.mirror.JournalMirror.readAllRows(mirror)
        assertEquals(1, rows.size)
        assertEquals(1L, rows[0].gs)

        // 模拟他端 rewrite 收缩（账本清空，replay lastSeq=0 < 本地尾 gs=1）→ open 对账触发镜像全量重建
        fake.shrink()
        s.open()
        assertEquals(0, nova.agent.net.mirror.JournalMirror.readAllRows(mirror).size)
        assertEquals(0, s.readAll().size)
    }
}
