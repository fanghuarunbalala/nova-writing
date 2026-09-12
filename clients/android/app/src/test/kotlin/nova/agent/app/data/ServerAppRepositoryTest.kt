package nova.agent.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import nova.agent.net.auth.FileTokenStore
import nova.agent.net.auth.ServerAuthClient
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.ServerHttp
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** ServerAppRepository 认证/项目/设备真接线（MockWebServer 起 server 语义）。 */
class ServerAppRepositoryTest {

    private lateinit var server: MockWebServer
    private lateinit var scope: CoroutineScope
    private lateinit var repo: ServerAppRepository
    private val savedUrls = mutableListOf<String>()

    private fun json(code: Int, body: String): MockResponse =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun grant() = """{"accessToken":"at-1","refreshToken":"rt-1","userId":"u-1","deviceId":"d-1"}"""
    private fun projects(vararg items: String) = """{"projects":[${items.joinToString(",")}]}"""

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        val auth = ServerAuthSession(
            tokenStore = FileTokenStore(Files.createTempDirectory("nova-tokens").resolve("t.json")),
            clientFactory = { ServerAuthClient(it) },
        )
        repo = ServerAppRepository(
            scope = scope,
            authSession = auth,
            loadServerUrl = { savedUrls.lastOrNull() ?: "" },
            saveServerUrl = { savedUrls += it },
            httpFactory = { ServerHttp(it) },
        )
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
        server.shutdown()
    }

    private suspend fun <T> awaitUntil(flow: kotlinx.coroutines.flow.StateFlow<T>, predicate: (T) -> Boolean): T =
        withTimeout(5_000) { flow.first { predicate(it) } }

    @Test
    fun loginSuccessMapsOnlineProjectsAndDevices() = runBlocking {
        val url = server.url("").toString().trimEnd('/')
        server.enqueue(json(200, grant()))
        server.enqueue(json(200, projects("""{"id":"p-1","name":"长夜余烬","createdAt":100,"lastActivityAt":900000}""")))
        server.enqueue(
            json(
                200,
                """{"devices":[{"id":"d-1","name":"Pixel 9","created_at":0,"last_seen_at":0,"active_sessions":1},{"id":"d-2","name":"Mac","created_at":0,"last_seen_at":0,"active_sessions":0}]}""",
            )
        )

        repo.login("alice", "password123", "Pixel 9", url)

        val online = awaitUntil(repo.auth) { it is AuthUiState.Online }
        assertEquals(AuthUiState.Online("alice", url), online)
        assertEquals(url, savedUrls.single(), "serverUrl 应持久化")

        val projects = awaitUntil(repo.projects) { it.isNotEmpty() }
        assertEquals("长夜余烬", projects.single().name)
        assertTrue(projects.single().updatedAtLabel.isNotBlank())
        assertEquals("p-1", repo.currentProjectId.value, "首个项目自动选中")

        val devices = awaitUntil(repo.devices) { it.size == 2 }
        assertTrue(devices.first { it.id == "d-1" }.current, "本机 deviceId=d-1 应标记 current")
        assertEquals("当前会话", devices.first { it.id == "d-1" }.lastActiveLabel)
    }

    @Test
    fun invalidCredentialsEmitsMappedError() = runBlocking {
        val url = server.url("").toString().trimEnd('/')
        server.enqueue(json(401, """{"code":"invalid_credentials","message":"bad"}"""))
        val errors = mutableListOf<String>()
        val collector = launch(Dispatchers.Unconfined) { repo.loginErrors.collect { errors += it } }

        repo.login("alice", "wrong-pass", "Pixel", url)

        withTimeout(5_000) { while (errors.isEmpty()) delay(10) }
        assertEquals("用户名或密码不正确", errors.single())
        assertEquals(AuthUiState.Unconfigured, repo.auth.value, "登录失败回未配置态")
        collector.cancel()
    }

    @Test
    fun registerUsernameTakenEmitsMappedError() = runBlocking {
        val url = server.url("").toString().trimEnd('/')
        server.enqueue(json(409, """{"code":"username_taken","message":"taken"}"""))
        val errors = mutableListOf<String>()
        val collector = launch(Dispatchers.Unconfined) { repo.loginErrors.collect { errors += it } }

        repo.register("alice", "password123", "Pixel", url)

        withTimeout(5_000) { while (errors.isEmpty()) delay(10) }
        assertEquals("用户名已被占用", errors.single())
        collector.cancel()
    }

    @Test
    fun createProjectPostsAndRefreshes() = runBlocking {
        val url = server.url("").toString().trimEnd('/')
        server.enqueue(json(200, grant()))
        server.enqueue(json(200, projects()))
        server.enqueue(json(200, """{"devices":[]}"""))
        repo.login("alice", "password123", "Pixel", url)
        awaitUntil(repo.auth) { it is AuthUiState.Online }
        awaitRequests(3) // login + projects + devices 全部消费完，队列清空后再入队

        server.enqueue(json(201, """{"id":"p-9","name":"新书"}"""))
        server.enqueue(json(200, projects("""{"id":"p-1","name":"旧书"}""", """{"id":"p-9","name":"新书"}""")))
        repo.createProject("新书")
        awaitUntil(repo.projects) { it.size == 2 }

        repeat(3) { server.takeRequest() } // 跳过 login/projects/devices
        val create = server.takeRequest()
        assertEquals("/v1/projects", create.path)
        assertTrue(create.body.readUtf8().contains("新书"))
    }

    @Test
    fun kickCurrentDeviceLeadsToNeedRelogin() = runBlocking {
        val url = server.url("").toString().trimEnd('/')
        server.enqueue(json(200, grant()))
        server.enqueue(json(200, projects()))
        server.enqueue(json(200, """{"devices":[{"id":"d-1","name":"Pixel 9","created_at":0,"last_seen_at":0,"active_sessions":1}]}"""))
        repo.login("alice", "password123", "Pixel 9", url)
        awaitUntil(repo.auth) { it is AuthUiState.Online }
        awaitUntil(repo.devices) { it.size == 1 } // refreshDevices 消费完，队列清空

        server.enqueue(json(204, ""))
        repo.kick("d-1")

        val state = awaitUntil(repo.auth) { it == AuthUiState.NeedRelogin }
        assertEquals(AuthUiState.NeedRelogin, state)
    }

    private suspend fun awaitRequests(count: Int) {
        withTimeout(5_000) { while (server.requestCount < count) delay(10) }
    }
}
