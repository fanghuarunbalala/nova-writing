package nova.agent.app.data.conversation

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import nova.agent.app.data.RealChatRepository
import nova.agent.app.support.FakeNovaServer
import nova.agent.app.support.FakeProvider
import nova.agent.app.support.InMemoryPendingQueue
import nova.agent.app.support.waitFor
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason
import nova.agent.model.ToolCall
import nova.agent.net.auth.FileTokenStore
import nova.agent.net.auth.ServerAuthClient
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.sse.ServerEvent
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * RealChatRepository 全链路（PRD FR12）：MockWebServer 假 server + FakeProvider + 内存积压队。
 * 覆盖：submit→journal 落库→审批上报→他端裁决→gate 放行→RunEnd；
 * 断网积压→恢复 drain；409 只读分支→SSE 投影折叠。
 */
class RealChatRepositoryTest {

    private lateinit var fake: FakeNovaServer
    private lateinit var scope: CoroutineScope
    private lateinit var authSession: ServerAuthSession
    private val provider = FakeProvider()
    private val pending = InMemoryPendingQueue()
    private val coordinatorRef = java.util.concurrent.atomic.AtomicReference<ConversationCoordinator?>()
    private lateinit var coordinator: ConversationCoordinator
    private lateinit var repo: RealChatRepository
    private val collected = mutableListOf<LoopEvent>()
    private val pills = mutableListOf<String>()

    @BeforeTest
    fun setUp() {
        fake = FakeNovaServer()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        authSession = ServerAuthSession(
            tokenStore = FileTokenStore(Files.createTempDirectory("nova-t").resolve("t.json")),
            clientFactory = { ServerAuthClient(it) },
        )
        authSession.restore(fake.baseUrl)
        val lease = LeaseCoordinator(
            scope = scope,
            transport = LeaseClientTransport({ fake.http() }, authSession, baseUrlProvider = { fake.baseUrl }),
            stopActiveRun = { coordinatorRef.get()?.stopAllRuns() },
            onNeedRelogin = { },
            deviceNameOf = { ConversationRegistry.shortCode(it) },
        )
        coordinator = ConversationCoordinator(
            scope = scope,
            registry = ConversationRegistry(Files.createTempDirectory("nova-conv")),
            leaseCoordinator = lease,
            baseUrl = { fake.baseUrl },
            httpFactory = { fake.http() },
            authSession = authSession,
            pendingQueue = pending,
            providerFactory = { provider },
            loadDefinition = { null },
        ).also { coordinatorRef.set(it) }
        repo = RealChatRepository(coordinator)
        scope.launch { repo.events.collect { collected += it } }
        scope.launch { coordinator.pills.collect { pills += it } }
        kotlinx.coroutines.runBlocking { authSession.login("alice", "password123", "Test") }
    }

    @AfterTest
    fun tearDown() {
        kotlinx.coroutines.runBlocking { runCatching { coordinator.closeAll() } }
        scope.cancel()
        fake.close()
    }

    private fun writeCall() = ToolCall(
        "t-1", "novel_write_paragraph",
        """{"id":"p-1","storyUnitId":"u1","orderKey":1,"text":"雪落了满肩。","title":"新增段落","op":"add","change":"第一章开篇"}""",
    )

    @Test
    fun submitApprovalCrossDeviceResolveRunEnd() {
        provider.enqueue(FakeProvider.ScriptedTurn(deltas = listOf("写入"), toolCalls = listOf(writeCall())))
        provider.enqueue(FakeProvider.ScriptedTurn(deltas = listOf("已写入")))

        val outcome = kotlinx.coroutines.runBlocking { coordinator.open(projectId = "p1", cid = null) }
        assertIs<ConversationCoordinator.OpenOutcome.Holder>(outcome)
        val cid = coordinator.active.value!!.conversationId

        coordinator.startRun(RunSource.USER, "续写第一章")
        waitFor { collected.any { it is LoopEvent.ApprovalRequested } }
        assertTrue(fake.reportedApprovals.isNotEmpty(), "审批已上报 server")

        // 他端裁决（GlobalChannel 路径模拟——conversationId 路由到 gate）
        val rid = (collected.first { it is LoopEvent.ApprovalRequested } as LoopEvent.ApprovalRequested).requestId
        coordinator.routeApprovalResolved(ServerEvent.ApprovalResolved(cid, rid, "approve", null, "d-2"))

        waitFor { collected.any { it is LoopEvent.RunEnd } }
        val end = collected.last { it is LoopEvent.RunEnd } as LoopEvent.RunEnd
        assertEquals(RunEndReason.COMPLETED, end.reason)
        assertTrue(fake.rowCount >= 2, "journal 行已落 server（实际 ${fake.rowCount}）")
        assertTrue(collected.any { it is LoopEvent.ToolCallResponse && it.toolCallId == "t-1" })
    }

    @Test
    fun offlineEnqueuesJournalAndRecoversOnReopen() {
        provider.enqueueText("离线期间的回答")

        val outcome = kotlinx.coroutines.runBlocking { coordinator.open(projectId = "p1", cid = null) }
        assertIs<ConversationCoordinator.OpenOutcome.Holder>(outcome)
        val cid = coordinator.active.value!!.conversationId

        fake.offline = true
        coordinator.startRun(RunSource.USER, "断网续写")
        waitFor { collected.any { it is LoopEvent.RunEnd } }
        assertEquals(RunEndReason.COMPLETED, (collected.last { it is LoopEvent.RunEnd } as LoopEvent.RunEnd).reason, "run 不因断网中断")
        assertTrue(kotlinx.coroutines.runBlocking { pending.count("") } > 0, "账本行已入积压队")

        fake.offline = false
        kotlinx.coroutines.runBlocking { coordinator.closeAll() }
        // 重开同会话：HttpJournalStore.open() 对账后按序补推
        val reopen = kotlinx.coroutines.runBlocking { coordinator.open(projectId = "p1", cid = cid) }
        assertIs<ConversationCoordinator.OpenOutcome.Holder>(reopen)
        waitFor { kotlinx.coroutines.runBlocking { pending.count("") == 0 } }
        waitFor { pills.any { it.contains("已补推") } }
    }

    @Test
    fun readOnlyBranchProjectsHolderRunsThroughWatcher() {
        // 第一阶段：本机持有跑一个纯文本 run（无工具无审批），journal 落 server
        provider.enqueueText(" holder 写下的回答")
        val holderOutcome = kotlinx.coroutines.runBlocking { coordinator.open(projectId = "p1", cid = null) }
        assertIs<ConversationCoordinator.OpenOutcome.Holder>(holderOutcome)
        val cid = coordinator.active.value!!.conversationId
        coordinator.startRun(RunSource.USER, "持有端输入")
        waitFor { collected.any { it is LoopEvent.RunEnd } }
        val rowsBefore = fake.rowCount
        assertTrue(rowsBefore >= 2)
        kotlinx.coroutines.runBlocking { coordinator.closeAll() }

        // 第二阶段：他端持租 → 409 只读分支，SSE/replay 投影复刻
        fake.leaseHeldBy = "d-2"
        collected.clear()
        val readOnlyOutcome = kotlinx.coroutines.runBlocking { coordinator.open(projectId = "p1", cid = cid) }
        assertIs<ConversationCoordinator.OpenOutcome.ReadOnly>(readOnlyOutcome)

        waitFor { collected.any { it is LoopEvent.UserMessage && it.content == "持有端输入" } }
        waitFor { collected.any { it is LoopEvent.AssistantMessage && it.message.content.contains("holder 写下的回答") } }
        waitFor { collected.any { it is LoopEvent.RunEnd } }
        assertTrue(coordinator.active.value!!.readOnly)
    }
}
