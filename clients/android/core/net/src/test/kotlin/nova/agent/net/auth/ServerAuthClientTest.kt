package nova.agent.net.auth

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

class ServerAuthClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: ServerAuthClient

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = ServerAuthClient(server.url("").toString().trimEnd('/'))
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    private fun json(code: Int, body: String): MockResponse =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun loginSendsFieldsAndParsesGrant() = runTest {
        server.enqueue(
            json(
                200,
                """{"userId":"usr_1","deviceId":"dev_1","accessToken":"a1","refreshToken":"r1"}""",
            )
        )
        val grant = client.login("fang", "pass1234", "我的手机")
        assertEquals("a1", grant.accessToken)
        assertEquals("r1", grant.refreshToken)
        assertEquals("dev_1", grant.deviceId)

        val recorded = server.takeRequest()
        assertEquals("/v1/auth/login", recorded.path)
        assertEquals("POST", recorded.method)
        val body = recorded.body.readUtf8()
        assertTrue(body.contains(""""username":"fang""""))
        assertTrue(body.contains(""""deviceName":"我的手机""""))
    }

    @Test
    fun registerExpects201() = runTest {
        server.enqueue(json(201, """{"userId":"usr_2","deviceId":"dev_2","accessToken":"a","refreshToken":"r"}"""))
        client.register("newuser", "pass1234", "测试机")
        assertEquals("/v1/auth/register", server.takeRequest().path)
    }

    @Test
    fun invalidCredentialsSurfacesCode() = runTest {
        server.enqueue(json(401, """{"code":"invalid_credentials","message":"用户名或密码错误"}"""))
        try {
            client.login("fang", "wrong-pass", "x")
            fail("应抛 ServerApiException")
        } catch (e: nova.agent.net.http.ServerApiException) {
            assertEquals(401, e.status)
            assertEquals("invalid_credentials", e.code)
        }
    }

    @Test
    fun devicesMapsSnakeCase() = runTest {
        server.enqueue(
            json(
                200,
                """{"devices":[{"id":"dev_1","name":"桌面","created_at":1,"last_seen_at":2,"active_sessions":1}]}""",
            )
        )
        val devices = client.devices("tok")
        assertEquals(1, devices.size)
        assertEquals("桌面", devices[0].name)
        assertEquals(1, devices[0].activeSessions)

        val recorded = server.takeRequest()
        assertEquals("/v1/auth/devices", recorded.path)
        assertEquals("Bearer tok", recorded.getHeader("Authorization"))
    }

    @Test
    fun kickDeviceExpects204() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))
        client.kickDevice("tok", "dev_9")
        assertEquals("/v1/auth/devices/dev_9", server.takeRequest().path)
    }
}
