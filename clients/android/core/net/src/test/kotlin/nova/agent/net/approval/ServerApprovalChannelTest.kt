package nova.agent.net.approval

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import nova.agent.approval.ApprovalDecision
import nova.agent.approval.ApprovalGate
import nova.agent.approval.ApprovalRequest
import nova.agent.model.ToolCall
import nova.agent.net.http.ServerHttp
import nova.agent.net.sse.ServerEvent
import nova.agent.net.support.fixedAuthSession
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ServerApprovalChannelTest {

    private lateinit var server: MockWebServer
    private lateinit var channel: ServerApprovalChannel

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        channel = ServerApprovalChannel(ServerHttp(server.url("").toString().trimEnd('/')), fixedAuthSession("http://x"))
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    private fun json(code: Int, body: String): MockResponse =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun reportSendsExpectedBody() = runBlocking {
        server.enqueue(json(201, """{"requestId":"approval:c1:1:b1","status":"pending"}"""))
        channel.report(
            conversationId = "c1",
            runSeq = 1,
            requestId = "approval:c1:1:b1",
            calls = listOf(ToolCall("call_1", "novel_write_paragraph", """{"id":"p-1"}""")),
            leaseToken = "lt-1",
        )
        val recorded = server.takeRequest()
        assertEquals("/v1/approvals", recorded.path)
        val body = recorded.body.readUtf8()
        assertTrue(body.contains(""""requestId":"approval:c1:1:b1""""))
        assertTrue(body.contains(""""name":"novel_write_paragraph""""))
        assertTrue(body.contains(""""leaseToken":"lt-1""""))
    }

    @Test
    fun pendingDecodesCallsJsonString() = runBlocking {
        server.enqueue(
            json(
                200,
                """{"approvals":[{"request_id":"r1","conversation_id":"c1","run_seq":2,"status":"pending","calls_json":"[{\"id\":\"c9\",\"name\":\"novel_delete_paragraph\",\"arguments\":\"{}\"}]","created_at":5}]}""",
            )
        )
        val list = channel.pending("c1")
        assertEquals(1, list.size)
        assertEquals("r1", list[0].requestId)
        assertEquals("pending", list[0].status)
        assertEquals(1, list[0].calls.size)
        assertEquals("novel_delete_paragraph", list[0].calls[0].name)
    }

    @Test
    fun resolveIsSilentOnFailureAndConflict() = runBlocking {
        server.enqueue(json(500, """{"code":"boom"}"""))
        channel.resolve("r1", ApprovalDecision.Approve) // 网络失败静默
        server.enqueue(json(409, """{"code":"already_decided","message":"该审批已处于 approve"}"""))
        channel.resolve("r1", ApprovalDecision.Reject("不合意")) // 已决冲突静默
        assertEquals(2, server.requestCount)
    }

    @Test
    fun localAndSseResolveFirstWinsIdempotently() = runBlocking {
        val gate = ApprovalGate(timeoutMs = 60_000)
        val request = ApprovalRequest("approval:c1:1:b1", "c1", 1, listOf(ToolCall("c1", "novel_write_paragraph")))

        val decision = kotlinx.coroutines.CompletableDeferred<ApprovalDecision>()
        launch(Dispatchers.Default) { decision.complete(gate.await(request)) }

        nova.agent.net.support.waitFor { gate.pendingIds.contains("approval:c1:1:b1") }
        // 本地先决(approve)
        assertTrue(gate.resolve("approval:c1:1:b1", ApprovalDecision.Approve))
        // SSE 决议后到(他端 reject)——先到者生效,后到者不覆盖
        channel.onSseResolved(
            ServerEvent.ApprovalResolved("c1", "approval:c1:1:b1", "reject", "他端意见", "dev_x"),
            gate,
        )
        assertEquals(ApprovalDecision.Approve, decision.await())
        // 再来一次同样被忽略
        assertFalse(gate.resolve("approval:c1:1:b1", ApprovalDecision.Reject("x")))
    }

    @Test
    fun sseRejectMapsCommentIntoDecision() = runBlocking {
        val gate = ApprovalGate(timeoutMs = 60_000)
        val request = ApprovalRequest("approval:c1:2:b1", "c1", 2, listOf(ToolCall("c1", "novel_delete_paragraph")))
        val decision = kotlinx.coroutines.CompletableDeferred<ApprovalDecision>()
        launch(Dispatchers.Default) { decision.complete(gate.await(request)) }

        nova.agent.net.support.waitFor { gate.pendingIds.contains("approval:c1:2:b1") }
        channel.onSseResolved(
            ServerEvent.ApprovalResolved("c1", "approval:c1:2:b1", "reject", "节奏不对", "dev_mb14"),
            gate,
        )
        val actual = decision.await() as ApprovalDecision.Reject
        assertEquals("节奏不对", actual.comment)
    }

    @Test
    fun gateFactoryReportsToServerAndKeepsLocalUsableOnFailure() = runBlocking {
        server.enqueue(json(500, """{"code":"boom"}""")) // 上报失败:gate 仍可用
        val gate = channel.gate(
            conversationId = { "c1" },
            leaseToken = { "lt-1" },
        )
        val request = ApprovalRequest("approval:c1:3:b1", "c1", 3, listOf(ToolCall("c1", "novel_write_paragraph")))
        val decision = kotlinx.coroutines.CompletableDeferred<ApprovalDecision>()
        launch(Dispatchers.Default) { decision.complete(gate.await(request)) }

        nova.agent.net.support.waitFor { gate.pendingIds.contains("approval:c1:3:b1") && server.requestCount >= 1 }
        assertTrue(gate.resolve("approval:c1:3:b1", ApprovalDecision.Approve))
        assertEquals(ApprovalDecision.Approve, decision.await())
    }

    private fun waitForServerReport() {
        nova.agent.net.support.waitFor { server.requestCount >= 1 }
    }
}
