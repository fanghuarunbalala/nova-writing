package nova.agent.app.support

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.ToolCall
import nova.agent.model.Usage
import nova.agent.net.journal.PendingPushQueue
import nova.agent.net.journal.PendingRow
import nova.agent.net.journal.PendingPushOverflowException
import nova.agent.provider.DeltaType
import nova.agent.provider.Provider
import nova.agent.provider.ProviderDelta
import nova.agent.provider.ProviderRequest
import nova.agent.provider.ProviderResult
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import java.util.concurrent.TimeUnit

/** 内存待推队列（拷自 :core:net 测试支持——app 测试不可见跨模块 test 源）。 */
class InMemoryPendingQueue(private val maxRows: Int = 10_000) : PendingPushQueue {
    private val rows = mutableListOf<PendingRow>()
    private var nextId = 1L

    override suspend fun enqueue(conversationId: String, kind: String, runSeq: Int, messagesJson: String) {
        if (rows.size >= maxRows) throw PendingPushOverflowException(maxRows)
        rows += PendingRow(nextId++, kind, runSeq, messagesJson)
    }

    override suspend fun drainAll(conversationId: String): List<PendingRow> = rows.toList()

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

/** 永不过期令牌的内存 TokenStore（不走 refresh 路径）。 */
class InMemoryTokenStore4Test : nova.agent.net.auth.TokenStore {
    private var tokens: nova.agent.net.auth.AuthTokens? = nova.agent.net.auth.AuthTokens(
        accessToken = "at-1",
        refreshToken = "rt-1",
        username = "tester",
        userId = "u-1",
        deviceId = "d-1",
        accessExpiresAt = Long.MAX_VALUE,
    )

    override fun save(tokens: nova.agent.net.auth.AuthTokens) {
        this.tokens = tokens
    }

    override fun load(): nova.agent.net.auth.AuthTokens? = tokens

    override fun clear() {
        tokens = null
    }
}

/** 客户端侧断线开关（模拟 OfflineSwitch 同款）。 */
class OfflineSwitch : okhttp3.Interceptor {
    @Volatile
    var offline = false

    override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response {
        if (offline) throw java.io.IOException("simulated offline")
        return chain.proceed(chain.request())
    }
}

/**
 * nova 假 server（RealChatRepository 全链路用）：auth/lease/journal/approvals/domain/SSE 全端点。
 * SSE 为有限流（服务完当前积压即 [done] 收口，桥按退避重连——seq 游标保证幂等）。
 */
class FakeNovaServer : AutoCloseable {

    val server = MockWebServer()
    val offlineSwitch = OfflineSwitch()
    private val json = Json

    val baseUrl: String get() = server.url("").toString().trimEnd('/')

    /** 租约假状态：非 null = 409 lease_held（holderDeviceId）。 */
    @Volatile
    var leaseHeldBy: String? = null

    private data class Row(val seq: Long, val runSeq: Int, val kind: String, val payload: String)
    private val events = mutableListOf<Row>()
    private var nextSeq = 0L

    /** 已上报的审批（requestId → decision 可改写模拟裁决）。 */
    val reportedApprovals = mutableMapOf<String, String>()

    val rowCount: Int get() = events.size

    fun journalRowsSnapshot(): List<Triple<Long, Int, String>> = events.map { Triple(it.seq, it.runSeq, it.kind) }

    fun http(): nova.agent.net.http.ServerHttp = nova.agent.net.http.ServerHttp(
        baseUrl = baseUrl,
        client = okhttp3.OkHttpClient.Builder().addInterceptor(offlineSwitch).build(),
    )

    var offline: Boolean
        get() = offlineSwitch.offline
        set(value) {
            offlineSwitch.offline = value
        }

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                val method = request.method ?: "GET"
                val bodyText = request.body.snapshot().utf8()
                return try {
                    route(method, path, bodyText)
                } catch (e: Exception) {
                    MockResponse().setResponseCode(500).setBody("""{"code":"fake_error","message":"${e.message}"}""")
                }
            }
        }
        server.start()
    }

    private fun route(method: String, path: String, bodyText: String): MockResponse = when {
        method == "POST" && path == "/v1/auth/login" ->
            MockResponse().setBody(
                """{"accessToken":"at-1","refreshToken":"rt-1","userId":"u-1","deviceId":"d-1"}"""
            )

        method == "POST" && path == "/v1/leases" -> {
            val holder = leaseHeldBy
            if (holder != null) {
                MockResponse().setResponseCode(409).setBody(
                    """{"code":"lease_held","message":"held","holderDeviceId":"$holder","expiresAt":${System.currentTimeMillis() + 60_000}}"""
                )
            } else {
                MockResponse().setBody("""{"leaseToken":"lt-1","expiresAt":${System.currentTimeMillis() + 60_000},"renewed":false}""")
            }
        }

        method == "POST" && path.contains("/leases/") && path.endsWith("/heartbeat") ->
            MockResponse().setBody("""{"expiresAt":${System.currentTimeMillis() + 60_000}}""")

        method == "DELETE" && path.startsWith("/v1/leases/") ->
            MockResponse().setResponseCode(204)

        method == "POST" && path.startsWith("/v1/runs/") && path.endsWith("/events") -> {
            val body = json.parseToJsonElement(bodyText).jsonObject
            events += Row(
                seq = ++nextSeq,
                runSeq = body["runSeq"]!!.jsonPrimitive.content.toInt(),
                kind = body["kind"]!!.jsonPrimitive.content,
                payload = body["messages"].toString(),
            )
            MockResponse().setResponseCode(201).setBody("""{"seq":$nextSeq}""")
        }

        method == "GET" && path.startsWith("/v1/journal/") && path.contains("/replay") -> {
            val since = Regex("since=(\\d+)").find(path)?.groupValues?.get(1)?.toLongOrNull() ?: 0
            val rows = events.filter { it.seq > since }
            MockResponse().setBody(
                """{"events":[${rows.joinToString(",") { rowJson(it) }}],"lastSeq":${events.maxOfOrNull { it.seq } ?: 0}}"""
            )
        }

        method == "PUT" && path.startsWith("/v1/journal/") && path.endsWith("/rewrite") ->
            MockResponse().setBody("""{"lastSeq":${events.maxOfOrNull { it.seq } ?: 0}}""")

        method == "POST" && path == "/v1/approvals" -> {
            val body = json.parseToJsonElement(bodyText).jsonObject
            val rid = body["requestId"]!!.jsonPrimitive.content
            reportedApprovals[rid] = "pending"
            MockResponse().setResponseCode(201)
        }

        method == "GET" && path.startsWith("/v1/approvals") -> {
            val list = reportedApprovals.filter { it.value == "pending" }.map { (rid, _) ->
                """{"request_id":"$rid","conversation_id":"c1","run_seq":1,"status":"pending","calls_json":"[]"}"""
            }
            MockResponse().setBody("""{"approvals":[${list.joinToString(",")}]}""")
        }

        method == "POST" && path.startsWith("/v1/approvals/") && path.endsWith("/resolve") -> {
            val rid = path.removePrefix("/v1/approvals/").removeSuffix("/resolve")
            val body = json.parseToJsonElement(bodyText).jsonObject
            reportedApprovals[rid] = body["decision"]?.jsonPrimitive?.content ?: "approve"
            MockResponse().setBody("""{"ok":true}""")
        }

        method == "GET" && path.contains("/domain/snapshot") ->
            MockResponse().setBody("""{"cursor":0,"entities":[]}""")

        method == "GET" && path.contains("/domain/delta") ->
            MockResponse().setBody("""{"cursor":0,"entities":[]}""")

        method == "POST" && path.contains("/domain/mutate") ->
            MockResponse().setBody("""{"results":[{"id":"m_x","kind":"novel_mutation","entityVersion":1}],"seq":1}""")

        method == "GET" && path.startsWith("/v1/events") -> {
            val since = Regex("since=(\\d+)").find(path)?.groupValues?.get(1)?.toLongOrNull() ?: 0
            val lines = mutableListOf<String>()
            lines += sseLine("ready", mapOf("conversationId" to "c1", "backlog" to 0))
            events.filter { it.seq > since }.forEach { r ->
                sseLine(
                    "journal",
                    mapOf(
                        "conversationId" to "c1", "seq" to r.seq, "runSeq" to r.runSeq,
                        "kind" to r.kind, "payload" to JsonPrimitive(r.payload),
                    ),
                ).let(lines::add)
            }
            reportedApprovals.filter { it.value == "pending" }.forEach { (rid, _) ->
                lines += sseLine(
                    "approval_requested",
                    mapOf("conversationId" to "c1", "requestId" to rid, "runSeq" to 1, "calls" to JsonPrimitive("[]")),
                )
            }
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody(lines.joinToString("") { "$it\n" } + "\n")
        }

        else -> MockResponse().setResponseCode(404).setBody("""{"code":"not_found","message":"$method $path"}""")
    }

    /** buildJsonObject 组帧（payload 内嵌 JSON 必须走正规转义，手拼必炸）。 */
    private fun sseLine(type: String, fields: Map<String, Any>): String {
        val obj = kotlinx.serialization.json.buildJsonObject {
            put("type", type)
            fields.forEach { (k, v) ->
                when (v) {
                    is String -> put(k, v)
                    is Int -> put(k, v)
                    is Long -> put(k, v)
                    is JsonPrimitive -> put(k, v as kotlinx.serialization.json.JsonElement)
                }
            }
        }
        return "data: $obj"
    }

    private fun rowJson(r: Row): String =
        """{"seq":${r.seq},"conversation_id":"c1","run_seq":${r.runSeq},"kind":"${r.kind}","payload":${JsonPrimitive(r.payload)},"definition_version":null,"created_at":0}"""

    override fun close() {
        server.shutdown()
    }
}

/** 脚本化 Provider（:app 测试自备，:core:provider 测试源不可见）。 */
class FakeProvider : Provider {
    data class ScriptedTurn(
        val deltas: List<String> = emptyList(),
        val toolCalls: List<ToolCall> = emptyList(),
        val finish: FinishReason = if (toolCalls.isEmpty()) FinishReason.STOP else FinishReason.TOOL_CALL,
    )

    private val queue = ArrayDeque<ScriptedTurn>()
    val requests = mutableListOf<ProviderRequest>()

    fun enqueue(turn: ScriptedTurn) {
        queue += turn
    }

    fun enqueueText(text: String) = enqueue(ScriptedTurn(deltas = listOf(text)))

    override suspend fun call(request: ProviderRequest, onDelta: suspend (ProviderDelta) -> Unit): ProviderResult {
        requests += request
        val turn = queue.removeFirstOrNull() ?: throw IllegalStateException("FakeProvider 脚本耗尽")
        turn.deltas.forEach { onDelta(ProviderDelta(DeltaType.TEXT, it)) }
        val message = LLMessage.Assistant(
            content = turn.deltas.joinToString(""),
            toolCalls = turn.toolCalls,
            finishReason = turn.finish,
        )
        return ProviderResult(message, Usage())
    }

    companion object {
        fun toolCall(id: String, name: String, arguments: String = "{}") = ToolCall(id, name, arguments)
    }
}
