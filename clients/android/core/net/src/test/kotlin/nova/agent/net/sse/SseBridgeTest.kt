package nova.agent.net.sse

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import nova.agent.net.support.fixedAuthSession
import nova.agent.net.support.waitFor
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SseBridgeTest {

    private lateinit var server: MockWebServer
    private val collected = mutableListOf<ServerEvent>()

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        collected.clear()
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    /** lines 为完整 SSE 行（data: xxx / : heartbeat）。响应体结束 = server 关流 → 客户端按退避重连。 */
    private fun sseResponse(vararg lines: String): MockResponse = MockResponse()
        .setHeader("Content-Type", "text/event-stream")
        .setBody(lines.joinToString("\n", postfix = "\n\n"))

    private fun bridge(cid: String? = "c1", since: Long = 0) = SseBridge(
        baseUrl = server.url("").toString().trimEnd('/'),
        conversationId = cid,
        auth = fixedAuthSession("http://x"),
        initialSince = since,
        backoffStepsMs = longArrayOf(50, 50, 50, 50),
    )

    @Test
    fun parsesFramesIgnoresHeartbeatAndUnknownType() = runBlocking {
        server.enqueue(
            sseResponse(
                ": heartbeat",
                """data: {"type":"ready","conversationId":"c1","backlog":2}""",
                """data: {"type":"journal","conversationId":"c1","seq":5,"runSeq":1,"kind":"append","payload":[{"type":"user","content":"hi"}],"definitionVersion":null}""",
                """data: {"type":"future_new_event","foo":1}""",
            )
        )
        server.enqueue(sseResponse("""data: {"type":"ready","conversationId":"c1","backlog":0}"""))

        val bridge = bridge()
        val collector = launch(kotlinx.coroutines.Dispatchers.Default) {
            bridge.events.collect { collected += it }
        }
        bridge.start(CoroutineScope(SupervisorJob() + Dispatchers.Default))

        waitFor { collected.size >= 3 }
        bridge.stop()
        collector.cancel()

        assertEquals(ServerEvent.Ready("c1", 2), collected[0])
        val journal = collected[1] as ServerEvent.Journal
        assertEquals(5, journal.seq)
        assertEquals("append", journal.kind)
        assertTrue(collected[2] is ServerEvent.Unknown)
        // 心跳注释行未产生事件
        assertTrue(collected.none { it is ServerEvent.Ready && it.backlog == -1 })
        // 状态走完 Connecting → Ready
        waitFor { bridge.state.value == SseState.Ready || collected.size >= 3 }
    }

    @Test
    fun cursorAdvancesBySeqAndRewrittenResetsToZero() = runBlocking {
        server.enqueue(
            sseResponse(
                """data: {"type":"journal","conversationId":"c1","seq":7,"runSeq":1,"kind":"append","payload":[]}""",
            )
        )
        server.enqueue(
            sseResponse(
                """data: {"type":"journal_rewritten","conversationId":"c1","lastSeq":2,"runCount":1}""",
                """data: {"type":"ready","conversationId":"c1","backlog":0}""",
            )
        )

        val bridge = bridge()
        val collector = launch(kotlinx.coroutines.Dispatchers.Default) {
            bridge.events.collect { collected += it }
        }
        bridge.start(CoroutineScope(SupervisorJob() + Dispatchers.Default))

        // 第一条 journal(seq=7)推进游标到 7;EOF 后 50ms 重连,第二流内 journal_rewritten → 游标归零
        waitFor { collected.any { it is ServerEvent.JournalRewritten } }
        assertEquals(0, bridge.cursor)
        assertTrue(collected.any { it is ServerEvent.Journal })

        bridge.stop()
        collector.cancel()
    }

    @Test
    fun reconnectCarriesSinceCursor() = runBlocking {
        server.enqueue(
            sseResponse(
                """data: {"type":"journal","conversationId":"c1","seq":9,"runSeq":1,"kind":"append","payload":[]}""",
            )
        )
        server.enqueue(sseResponse("""data: {"type":"ready","conversationId":"c1","backlog":0}"""))

        val bridge = bridge()
        val collector = launch(kotlinx.coroutines.Dispatchers.Default) {
            bridge.events.collect { collected += it }
        }
        bridge.start(CoroutineScope(SupervisorJob() + Dispatchers.Default))

        waitFor { server.requestCount >= 2 } // 首连 + EOF 后 50ms 重连
        bridge.stop()
        collector.cancel()

        val firstPath = server.takeRequest().path!!
        val secondPath = server.takeRequest().path!!
        assertTrue(firstPath.contains("since=0"))
        assertTrue(secondPath.contains("since=9"), "重连应携带推进后的游标 since=9: $secondPath")
        assertEquals(9, bridge.cursor)
    }

    @Test
    fun backoffSequenceAndResetOnSuccess() = runBlocking {
        // 失败序列:连接被拒 3 次(DISCONNECT_AT_START → IOException)→ 退避 50/50/50(注入的平坦步进)
        repeat(3) { server.enqueue(MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AT_START)) }
        server.enqueue(sseResponse("""data: {"type":"ready","conversationId":"c1","backlog":0}"""))
        server.enqueue(sseResponse("""data: {"type":"ready","conversationId":"c1","backlog":0}"""))

        val bridge = bridge()
        val collector = launch(kotlinx.coroutines.Dispatchers.Default) {
            bridge.events.collect { collected += it }
        }
        bridge.start(CoroutineScope(SupervisorJob() + Dispatchers.Default))

        // 3 次失败 + 1 次成功 + EOF 重连 = 5 次请求
        waitFor(timeoutMs = 8_000) { server.requestCount >= 5 }
        bridge.stop()
        collector.cancel()

        assertEquals(5, server.requestCount)
        assertTrue(collected.any { it is ServerEvent.Ready })
    }

    @Test
    fun stopCancelsConnectionWithoutLeak() = runBlocking {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream")
                .setBody("""data: {"type":"ready","conversationId":"c1","backlog":0}"""),
        )
        val bridge = bridge()
        val collector = launch(kotlinx.coroutines.Dispatchers.Default) {
            bridge.events.collect { collected += it }
        }
        bridge.start(CoroutineScope(SupervisorJob() + Dispatchers.Default))
        // 等 ready 事件而非 state(EOF 后重连会把 Ready 盖回 Connecting,state 窗口极窄)
        waitFor { collected.any { it is ServerEvent.Ready } }

        bridge.stop()
        assertEquals(SseState.Closed, bridge.state.value)
        // stop 后不再产生新请求(无悬挂重连循环)
        val count = server.requestCount
        Thread.sleep(150)
        assertEquals(count, server.requestCount)
        collector.cancel()
    }
}
