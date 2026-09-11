package nova.agent.net.auth

import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import nova.agent.net.support.InMemoryTokenStore
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertThrows
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ServerAuthSessionTest {

    private lateinit var server: MockWebServer
    private lateinit var store: InMemoryTokenStore
    private var nowMs = 1_000_000L
    private lateinit var session: ServerAuthSession

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        store = InMemoryTokenStore()
        session = ServerAuthSession(store, { ServerAuthClient(it) }, now = { nowMs }).apply {
            restore(server.url("").toString().trimEnd('/'))
        }
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    private fun json(code: Int, body: String): MockResponse =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun tokens(expiresIn: Long = Long.MAX_VALUE - 1_000_000) = AuthTokens(
        accessToken = "a-old", refreshToken = "r-old", username = "fang",
        userId = "usr_1", deviceId = "dev_1", accessExpiresAt = nowMs + expiresIn,
    )

    @Test
    fun unconfiguredWhenNoUrl() = runTest {
        val s = ServerAuthSession(store, { ServerAuthClient(it) }, now = { nowMs })
        assertEquals(AuthState.Unconfigured, s.state.value)
        assertNull(s.ensureAccessToken())
    }

    @Test
    fun loginEstablishesOnlineAndPersists() = runTest {
        server.enqueue(json(200, """{"userId":"usr_1","deviceId":"dev_1","accessToken":"a1","refreshToken":"r1"}"""))
        session.login("fang", "pass1234", "我的手机")
        assertEquals(AuthState.Online("fang", "dev_1"), session.state.value)
        assertEquals("r1", store.tokens?.refreshToken)
        assertEquals(nowMs + ServerAuthSession.ACCESS_TTL_MS, store.tokens?.accessExpiresAt)
    }

    @Test
    fun freshTokenReturnsDirectlyWithoutRefresh() = runTest {
        store.tokens = tokens(expiresIn = 10 * 60_000)
        session.restore(server.url("").toString().trimEnd('/'))
        assertEquals("a-old", session.ensureAccessToken())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun expiringTokenRotatesSingleFlight() = runTest {
        store.tokens = tokens(expiresIn = 30_000) // < REFRESH_AHEAD 60s
        session.restore(server.url("").toString().trimEnd('/'))
        server.enqueue(json(200, """{"userId":"usr_1","deviceId":"dev_1","accessToken":"a-new","refreshToken":"r-new"}"""))

        val first = async { session.ensureAccessToken() }
        val second = async { session.ensureAccessToken() }
        assertEquals("a-new", first.await())
        assertEquals("a-new", second.await())
        // 单飞：并发取 token 只发一次 refresh——refresh 一次一换，并发用旧 token 会触发复用检测误杀会话族
        assertEquals(1, server.requestCount)
        assertEquals("r-new", store.tokens?.refreshToken)
        // username 保留（server 不回传）
        assertEquals("fang", store.tokens?.username)
    }

    @Test
    fun reuseDetectionClearsTokensToNeedRelogin() = runTest {
        store.tokens = tokens(expiresIn = 30_000)
        session.restore(server.url("").toString().trimEnd('/'))
        server.enqueue(json(401, """{"code":"token_reuse_detected","message":"检测到刷新令牌复用"}"""))

        assertNull(session.ensureAccessToken())
        assertEquals(AuthState.NeedRelogin, session.state.value)
        assertNull(store.tokens)
        // 再取 token：needRelogin 直接 null,不再发请求
        assertNull(session.ensureAccessToken())
        assertEquals(1, server.requestCount)
    }

    @Test
    fun networkFailureMarksOfflineButKeepsTokens() = runTest {
        store.tokens = tokens(expiresIn = 30_000)
        session.restore(server.url("").toString().trimEnd('/'))
        server.shutdown()

        assertNull(session.ensureAccessToken())
        assertEquals(AuthState.Offline, session.state.value)
        assertEquals("r-old", store.tokens?.refreshToken)
    }

    @Test
    fun kickSelfDeviceRevokesLocalSession() = runTest {
        store.tokens = tokens()
        session.restore(server.url("").toString().trimEnd('/'))
        server.enqueue(MockResponse().setResponseCode(204))

        session.kickDevice("dev_1") // 踢的是本机
        assertEquals(AuthState.NeedRelogin, session.state.value)
        assertNull(store.tokens)
    }

    @Test
    fun logoutRevokesRemoteBestEffortAndClears() = runTest {
        store.tokens = tokens()
        session.restore(server.url("").toString().trimEnd('/'))
        server.enqueue(json(500, """{"code":"boom"}""")) // 远端失败也继续本地登出

        session.logout()
        assertEquals(AuthState.Unconfigured, session.state.value)
        assertNull(store.tokens)
    }

    @Test
    fun reportRequestFailureOn401WithNoTokensRaisesNeedRelogin() = runTest {
        session.reportRequestFailure(nova.agent.net.http.ServerApiException(401, "unauthorized", "x"))
        assertEquals(AuthState.NeedRelogin, session.state.value)
    }

    @Test
    fun kickOtherDeviceKeepsSession() = runTest {
        store.tokens = tokens()
        session.restore(server.url("").toString().trimEnd('/'))
        server.enqueue(MockResponse().setResponseCode(204))

        session.kickDevice("dev_other")
        assertEquals(AuthState.Online("fang", "dev_1"), session.state.value)
        assertTrue(server.takeRequest().path!!.endsWith("/devices/dev_other"))
    }
}
