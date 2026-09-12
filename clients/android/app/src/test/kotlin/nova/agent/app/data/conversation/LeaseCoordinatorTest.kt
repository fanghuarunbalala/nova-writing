package nova.agent.app.data.conversation

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import nova.agent.app.data.ChatOneShot
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/** LeaseCoordinator 状态机全迁移矩阵（PRD §1.5 / FR12）。 */
class LeaseCoordinatorTest {

    private lateinit var scope: CoroutineScope
    private val stopRunCalls = mutableListOf<Unit>()
    private val reloginCalls = mutableListOf<Unit>()
    private val released = mutableListOf<Pair<String, String>>()
    private val lossSignals = mutableListOf<(String) -> Unit>()

    private var nextResult: LeaseTransport.Acquire = LeaseTransport.Acquire.Granted("lt-1", 1_000)

    private lateinit var coordinator: LeaseCoordinator

    private val fakeTransport = object : LeaseTransport {
        override suspend fun acquire(cid: String): LeaseTransport.Acquire = nextResult

        override fun startHeartbeat(scope: CoroutineScope, cid: String, token: () -> String?, onLost: (String) -> Unit) =
            scope.let { lossSignals += onLost; it.launch { } }

        override suspend fun release(cid: String, token: String) {
            released += cid to token
        }
    }

    @BeforeTest
    fun setUp() {
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        coordinator = LeaseCoordinator(
            scope = scope,
            transport = fakeTransport,
            stopActiveRun = { stopRunCalls += Unit },
            onNeedRelogin = { reloginCalls += Unit },
            deviceNameOf = { if (it == "d-9") "MacBook Pro 14" else ConversationRegistry.shortCode(it) },
        )
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
    }

    @Test
    fun acquireGrantedEntersHolderWithToken() {
        val holder = assertIs<LeaseState.Holder>(kotlinx.coroutines.runBlocking { coordinator.acquire("c1") })
        assertEquals("lt-1", holder.leaseToken)
        assertEquals("lt-1", coordinator.token())
    }

    @Test
    fun acquireHeldEntersReadOnlyWithDeviceNameAndUiProjection() {
        nextResult = LeaseTransport.Acquire.Held("d-9", 2_000)
        val readOnly = assertIs<LeaseState.ReadOnly>(kotlinx.coroutines.runBlocking { coordinator.acquire("c1") })
        assertEquals("MacBook Pro 14", readOnly.holderDeviceName)
        assertEquals(null, coordinator.token(), "只读态无令牌")
        val ui = coordinator.leaseUi(seq = 42)
        assertEquals("d-9", ui?.deviceId)
        assertEquals(42, ui?.seq)
    }

    @Test
    fun heartbeatLostStopsRunAndEmitsTakeover() {
        kotlinx.coroutines.runBlocking { coordinator.acquire("c1") }
        val errors = mutableListOf<ChatOneShot>()
        val collector = scope.launch { coordinator.oneShots.collect { errors += it } }

        lossSignals.single().invoke("lease_expired")

        assertIs<LeaseState.Lost>(coordinator.state.value)
        assertEquals(1, stopRunCalls.size, "丢失即停当前 run")
        assertEquals(ChatOneShot.LeaseTakeover("其他设备"), errors.firstOrNull())
        collector.cancel()
    }

    @Test
    fun deviceRevokedLostAlsoTriggersRelogin() {
        kotlinx.coroutines.runBlocking { coordinator.acquire("c1") }
        lossSignals.single().invoke("device_revoked")
        assertIs<LeaseState.Lost>(coordinator.state.value)
        assertEquals(1, reloginCalls.size)
    }

    @Test
    fun resumeFromReadOnlyReacquiresToHolder() {
        nextResult = LeaseTransport.Acquire.Held("d-9", 2_000)
        kotlinx.coroutines.runBlocking { coordinator.acquire("c1") }
        assertIs<LeaseState.ReadOnly>(coordinator.state.value)

        nextResult = LeaseTransport.Acquire.Granted("lt-2", 3_000)
        val holder = assertIs<LeaseState.Holder>(kotlinx.coroutines.runBlocking { coordinator.resume("c1") })
        assertEquals("lt-2", holder.leaseToken)
    }

    @Test
    fun resumeStillHeldEmitsConflict409() {
        nextResult = LeaseTransport.Acquire.Held("d-9", 2_000)
        kotlinx.coroutines.runBlocking { coordinator.acquire("c1") }
        val errors = mutableListOf<ChatOneShot>()
        val collector = scope.launch { coordinator.oneShots.collect { errors += it } }

        kotlinx.coroutines.runBlocking { coordinator.resume("c1") }

        assertEquals(ChatOneShot.Conflict409("MacBook Pro 14"), errors.firstOrNull())
        assertIs<LeaseState.ReadOnly>(coordinator.state.value)
        collector.cancel()
    }

    @Test
    fun revokedAcquireLeadsToLostAndRelogin() {
        nextResult = LeaseTransport.Acquire.Revoked
        kotlinx.coroutines.runBlocking { coordinator.acquire("c1") }
        assertIs<LeaseState.Lost>(coordinator.state.value)
        assertEquals(1, reloginCalls.size)
    }

    @Test
    fun acquireErrorStaysIdleForOfflineBanner() {
        nextResult = LeaseTransport.Acquire.Error("network")
        assertEquals(LeaseState.Idle, kotlinx.coroutines.runBlocking { coordinator.acquire("c1") })
    }

    @Test
    fun leaseReleasedReturnsReadOnlyToIdle() {
        nextResult = LeaseTransport.Acquire.Held("d-9", 2_000)
        kotlinx.coroutines.runBlocking { coordinator.acquire("c1") }
        assertIs<LeaseState.ReadOnly>(coordinator.state.value)
        coordinator.onLeaseReleased()
        assertEquals(LeaseState.Idle, coordinator.state.value)
    }

    @Test
    fun releaseIsIdempotentAndReturnsIdle() {
        kotlinx.coroutines.runBlocking { coordinator.acquire("c1") }
        kotlinx.coroutines.runBlocking { coordinator.release() }
        assertEquals(LeaseState.Idle, coordinator.state.value)
        assertEquals(listOf("c1" to "lt-1"), released)
        kotlinx.coroutines.runBlocking { coordinator.release() }
        assertEquals(1, released.size, "二次 release 不再上送")
    }
}
