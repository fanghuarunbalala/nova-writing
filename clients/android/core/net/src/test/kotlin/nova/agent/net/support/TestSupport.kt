package nova.agent.net.support

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import nova.agent.net.auth.AuthTokens
import nova.agent.net.auth.FileTokenStore
import nova.agent.net.auth.ServerAuthClient
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.auth.TokenStore
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import java.util.concurrent.TimeUnit

/** 内存令牌仓（测试用）。 */
class InMemoryTokenStore : TokenStore {
    var tokens: AuthTokens? = null
    override fun save(tokens: AuthTokens) {
        this.tokens = tokens
    }

    override fun load(): AuthTokens? = tokens

    override fun clear() {
        tokens = null
    }
}

/** 固定时钟 + 永不过期令牌的会话（不走 refresh 路径）。 */
fun fixedAuthSession(baseUrl: String): ServerAuthSession {
    val store = InMemoryTokenStore()
    store.tokens = AuthTokens(
        accessToken = "tok-fixed",
        refreshToken = "ref-fixed",
        username = "tester",
        userId = "usr_1",
        deviceId = "dev_1",
        accessExpiresAt = Long.MAX_VALUE,
    )
    return ServerAuthSession(store, { ServerAuthClient(it) }, now = { 1_000_000L }).apply { restore(baseUrl) }
}

/** 内存待推队列（上限可注入，测溢出用小值）。 */
class InMemoryPendingQueue(private val maxRows: Int = 10_000) : nova.agent.net.journal.PendingPushQueue {
    private val rows = mutableListOf<nova.agent.net.journal.PendingRow>()
    private var nextId = 1L

    override suspend fun enqueue(conversationId: String, kind: String, runSeq: Int, messagesJson: String) {
        if (rows.size >= maxRows) throw nova.agent.net.journal.PendingPushOverflowException(maxRows)
        rows += nova.agent.net.journal.PendingRow(nextId++, kind, runSeq, messagesJson)
    }

    override suspend fun drainAll(conversationId: String): List<nova.agent.net.journal.PendingRow> = rows.toList()

    override suspend fun removeSent(ids: List<Long>) {
        rows.removeAll { it.id in ids }
    }

    override suspend fun count(conversationId: String): Int = rows.size
}

/** 真实时钟轮询等待（SSE/心跳这类跨真实 IO 线程的异步断言用）。 */
fun waitFor(timeoutMs: Long = 5_000, condition: () -> Boolean) {
    val start = System.nanoTime()
    while (!condition()) {
        if (System.nanoTime() - start > TimeUnit.MILLISECONDS.toNanos(timeoutMs)) {
            throw AssertionError("等待条件超时（${timeoutMs}ms）")
        }
        Thread.sleep(20)
    }
}

/** 客户端侧断线开关：OkHttp 拦截器直接抛 IOException（Dispatcher 的 DISCONNECT_AT_START 在 4.12 实测不生效）。 */
class OfflineSwitch : okhttp3.Interceptor {
    @Volatile
    var offline = false

    override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response {
        if (offline) throw java.io.IOException("simulated offline")
        return chain.proceed(chain.request())
    }
}

/**
 * 有状态账本假 server：journal 三端点（POST events / GET replay / PUT rewrite）全语义。
 * offline 经 [OfflineSwitch]（客户端拦截器）模拟——与 Server 端行为无关。
 * 供 HttpJournalStore 单测与三实现契约套件复用。
 */
class FakeLedgerServer : AutoCloseable {

    val server = MockWebServer()
    val offlineSwitch = OfflineSwitch()

    var offline: Boolean
        get() = offlineSwitch.offline
        set(value) {
            offlineSwitch.offline = value
        }

    /** 接好断线开关的 ServerHttp（测试一律用这个构造客户端）。 */
    fun http(): nova.agent.net.http.ServerHttp = nova.agent.net.http.ServerHttp(
        baseUrl = baseUrl,
        client = okhttp3.OkHttpClient.Builder().addInterceptor(offlineSwitch).build(),
    )

    private data class Row(val seq: Long, val runSeq: Int, val kind: String, val payload: String, val dv: String?)

    private val events = mutableListOf<Row>()
    private var nextSeq = 0L
    private val json = Json

    val baseUrl: String get() = server.url("").toString().trimEnd('/')
    val rowCount: Int get() = events.size

    /** 模拟他端 rewrite 收缩（账本清空——replay lastSeq 归零触发客户端全量重建镜像）。 */
    fun shrink() {
        events.clear()
    }

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                val method = request.method ?: "GET"
                // snapshot() 复制不消费——readUtf8() 会抽干 Buffer,导致测试侧 takeRequest().body 变空
                val bodyText = request.body.snapshot().utf8()
                return try {
                    route(method, path, bodyText)
                } catch (e: Exception) {
                    MockResponse().setResponseCode(500)
                        .setBody("""{"code":"fake_error","message":"${e.message}"}""")
                }
            }
        }
        server.start()
    }

    private fun route(method: String, path: String, bodyText: String): MockResponse {
        return when {
        method == "POST" && path.startsWith("/v1/runs/") && path.endsWith("/events") -> {
            val body = json.parseToJsonElement(bodyText).jsonObject
            val seq = ++nextSeq
            events += Row(
                seq = seq,
                runSeq = body["runSeq"]!!.jsonPrimitive.content.toInt(),
                kind = body["kind"]!!.jsonPrimitive.content,
                payload = body["messages"].toString(),
                dv = (body["definitionVersion"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
            )
            MockResponse().setResponseCode(201).setBody("""{"seq":$seq}""")
        }

        method == "GET" && path.startsWith("/v1/journal/") && path.contains("/replay") -> {
            val since = Regex("since=(\\d+)").find(path)?.groupValues?.get(1)?.toLongOrNull() ?: 0
            val rows = events.filter { it.seq > since }
            val lastSeq = events.maxOfOrNull { it.seq } ?: 0
            MockResponse().setBody(
                """{"events":[${rows.joinToString(",") { rowJson(it) }}],"lastSeq":$lastSeq}"""
            )
        }

        method == "PUT" && path.startsWith("/v1/journal/") && path.endsWith("/rewrite") -> {
            val body = json.parseToJsonElement(bodyText).jsonObject
            val expected = body["expectedLastSeq"]!!.jsonPrimitive.content.toLong()
            val current = events.maxOfOrNull { it.seq } ?: 0
            if (current != expected) {
                return MockResponse().setResponseCode(409)
                    .setBody("""{"code":"stale_rewrite","message":"账本已被并发写入","currentLastSeq":$current}""")
            }
            events.clear()
            body["runs"]!!.jsonArray.forEach { el ->
                val run = el.jsonObject
                events += Row(
                    seq = ++nextSeq,
                    runSeq = run["runSeq"]!!.jsonPrimitive.content.toInt(),
                    kind = "snapshot",
                    payload = run["messages"].toString(),
                    dv = null,
                )
            }
            MockResponse().setBody("""{"lastSeq":${events.maxOfOrNull { it.seq } ?: 0}}""")
        }

        else -> MockResponse().setResponseCode(404)
            .setBody("""{"code":"not_found","message":"fake 无此路由 $method $path"}""")
        }
    }

    private fun rowJson(r: Row): String =
        """{"seq":${r.seq},"conversation_id":"c1","run_seq":${r.runSeq},"kind":"${r.kind}","payload":${JsonPrimitive(r.payload)},"definition_version":${r.dv?.let { JsonPrimitive(it) } ?: "null"},"created_at":0}"""

    override fun close() {
        server.shutdown()
    }
}
