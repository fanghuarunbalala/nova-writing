package nova.agent.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import nova.agent.app.data.conversation.ConversationRegistry
import nova.agent.app.support.FakeNovaServer
import nova.agent.app.support.InMemoryTokenStore4Test
import nova.agent.app.support.waitFor
import nova.agent.net.approval.ServerApprovalChannel
import nova.agent.net.auth.ServerAuthClient
import nova.agent.net.auth.ServerAuthSession
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** 审批中心聚合与卡级/批级裁决语义（FR7）。 */
class ApprovalCenterTest {

    private lateinit var fake: FakeNovaServer
    private lateinit var scope: CoroutineScope
    private lateinit var center: ApprovalCenter
    private lateinit var registry: ConversationRegistry

    @BeforeTest
    fun setUp() {
        fake = FakeNovaServer()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        registry = ConversationRegistry(Files.createTempDirectory("nova-ac"))
        val auth = ServerAuthSession(
            tokenStore = InMemoryTokenStore4Test(),
            clientFactory = { ServerAuthClient(it) },
        ).apply { restore(fake.baseUrl) }
        center = ApprovalCenter(
            scope = scope,
            registry = registry,
            makeChannel = { ServerApprovalChannel(fake.http(), auth) },
        )
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
        fake.close()
    }

    @Test
    fun aggregatesPendingAcrossRegistryAndResolves() {
        kotlinx.coroutines.runBlocking { registry.register("c1", "p1") }
        fake.reportedApprovals["r-1"] = "pending"
        center.refresh()
        waitFor { center.approvals.value.size == 1 }
        assertEquals("r-1", center.approvals.value.single().requestId)

        // 卡级：无卡片场景直接落批级 → server 记录裁决 → 中心清空
        center.resolveCard("r-1", "cc-0", approved = true)
        waitFor { fake.reportedApprovals["r-1"] == "approve" }
        waitFor { center.approvals.value.isEmpty() }
    }

    @Test
    fun batchResolveRecordsDecisionOnServer() {
        kotlinx.coroutines.runBlocking { registry.register("c1", "p1") }
        fake.reportedApprovals["r-2"] = "pending"
        center.refresh()
        waitFor { center.approvals.value.size == 1 }

        center.resolve("r-2", approved = false)
        waitFor { fake.reportedApprovals["r-2"] == "reject" }
        waitFor { center.approvals.value.isEmpty() }
    }
}
