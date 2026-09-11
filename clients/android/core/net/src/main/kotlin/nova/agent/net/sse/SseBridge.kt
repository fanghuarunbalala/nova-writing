package nova.agent.net.sse

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.atomic.AtomicLong

/**
 * SSE 订阅桥（2026-09-11 架构评审定稿：自写，平移 OpenAICompatProvider 的取消桥模式）。
 *
 * 两层协程：
 * - 外层重连监督循环：退避 [1,2,5,10]s 封顶，**连接成功即归零**（桌面 ServerEventBridge 同款）；
 * - 内层阻塞读循环：Dispatchers.IO + ATOMIC 启动；外层取消 → call.cancel() 掐 socket
 *   → readLine 抛 IOException → 读协程收尾——零泄漏、无半开连接。
 *
 * 订阅模式（server /v1/events 两种行为）：
 * - 会话级（conversationId 非空）：since 游标随 journal 事件 seq 推进（任何带数字 seq 的事件，
 *   先于分发），断线重连 server 先补积压再推实时——幂等；journal_rewritten 时游标归零
 *   （Kotlin 侧加强：rewrite 后全量补拉，桌面靠读侧 REST 重读达成同等效果）；
 * - 全局（conversationId=null）：server 不回积压，纯实时流——审批中心收他端会话事件用。
 *
 * 帧规则：`:` 注释行（15s 心跳）与空行忽略；`data:` 单行 JSON 分发；
 * `data: [done]` 哨兵正常收流；非 JSON payload 忽略。
 */
class SseBridge(
    baseUrl: String,
    /** null = 全局订阅（全部事件，无积压回放）。 */
    val conversationId: String?,
    private val auth: ServerAuthSession,
    private val client: OkHttpClient = ServerHttp.sseClient(),
    initialSince: Long = 0,
    private val backoffStepsMs: LongArray = longArrayOf(1_000, 2_000, 5_000, 10_000),
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    private val baseUrl = baseUrl.trimEnd('/')

    private val _events = MutableSharedFlow<ServerEvent>(extraBufferCapacity = 256)
    val events: SharedFlow<ServerEvent> = _events.asSharedFlow()

    private val _state = MutableStateFlow<SseState>(SseState.Idle)
    val state: StateFlow<SseState> = _state.asStateFlow()

    /** 当前游标（会话级订阅断线重连的 since 参数；外部也可读取用于持久化）。 */
    val cursor: Long get() = since.get()
    private val since = AtomicLong(initialSince)

    @Volatile
    private var stopped = false
    private var loopJob: Job? = null

    /** 幂等启动；返回监督循环 Job（取消即整桥停止）。 */
    fun start(scope: CoroutineScope): Job {
        loopJob?.let { return it }
        stopped = false
        loopJob = scope.launch { runLoop() }
        return loopJob!!
    }

    /** 停止并断流（幂等）。 */
    suspend fun stop() {
        stopped = true
        loopJob?.cancelAndJoinSafely()
        loopJob = null
        _state.value = SseState.Closed
    }

    private suspend fun Job.cancelAndJoinSafely() {
        cancel()
        runCatching { join() }
    }

    private suspend fun runLoop() {
        var backoffIndex = 0
        while (!stopped && currentCoroutineContext().isActive) {
            _state.value = SseState.Connecting
            try {
                connectOnce()
                backoffIndex = 0 // 连接正常收流（含 server 关流 EOF）→ 退避归零，1s 后重连
            } catch (e: CancellationException) {
                throw e
            } catch (e: ServerApiException) {
                if (e.status == 401) _state.value = SseState.NeedRelogin
                backoffIndex += 1
            } catch (_: Exception) {
                backoffIndex += 1
            }
            if (stopped) break
            val delayMs = backoffStepsMs[backoffIndex.coerceAtMost(backoffStepsMs.size - 1)]
            _state.value = if (backoffIndex > 0) SseState.Reconnecting(delayMs) else SseState.Connecting
            delay(delayMs)
        }
        if (stopped) _state.value = SseState.Closed
    }

    private suspend fun connectOnce() {
        val token = auth.ensureAccessToken()
            ?: throw ServerApiException(0, "not_logged_in", "server 未登录或离线") // 走退避等待 auth 恢复
        val url = buildString {
            append(baseUrl).append("/v1/events?since=").append(since.get())
            conversationId?.let { append("&conversationId=").append(java.net.URLEncoder.encode(it, "UTF-8")) }
        }
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream")
            .get()
            .build()
        val call = client.newCall(request)
        coroutineScope {
            val done = CompletableDeferred<Unit>()
            val reader = launch(io, start = CoroutineStart.ATOMIC) {
                try {
                    done.complete(readLoop(call))
                } catch (cancelled: CancellationException) {
                    done.cancel(cancelled)
                } catch (t: Throwable) {
                    done.completeExceptionally(t)
                }
            }
            try {
                done.await()
            } catch (e: CancellationException) {
                call.cancel() // 掐 socket → readLine 立刻抛 IOException → reader 收尾
                throw e
            }
        }
    }

    /** 阻塞读循环（IO 协程）：只认 `data:` 行；`:` 注释心跳与空行跳过。 */
    private suspend fun readLoop(call: Call): Unit = withContext(io) {
        call.execute().use { response ->
            if (response.code == 401) throw ServerApiException(401, "unauthorized", "SSE 订阅被拒（401）")
            if (!response.isSuccessful) throw ServerApiException(response.code, "http_${response.code}", "SSE 订阅失败")
            _state.value = SseState.Ready
            val reader = response.body?.byteStream()?.bufferedReader()
                ?: throw ServerApiException(response.code, "empty_body", "SSE 空响应体")
            while (true) {
                currentCoroutineContext().ensureActive()
                val line = try {
                    reader.readLine() ?: break // EOF：server 关流，正常收流
                } catch (e: IOException) {
                    currentCoroutineContext().ensureActive() // 区分「取消掐断」与真实网络错
                    throw nova.agent.net.http.NetworkUnreachableException(e)
                }
                if (line.isEmpty() || line.startsWith(":")) continue
                if (!line.startsWith("data:")) continue
                val payload = line.removePrefix("data:").trim()
                if (payload.isEmpty()) continue
                if (payload == "[done]") break // 哨兵（桌面兼容；server 目前不发）
                dispatch(payload)
            }
        }
    }

    private suspend fun dispatch(payload: String) {
        val obj = try {
            json.parseToJsonElement(payload).jsonObject
        } catch (_: Exception) {
            return // 非 JSON 帧忽略
        }
        // 游标先于分发：任何带数字 seq 的事件推进（journal/domain_changed 共用账本 seq 空间）
        (obj["seq"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull()?.let { seq ->
            since.updateAndGet { current -> maxOf(current, seq) }
        }
        val event = ServerEvent.decode(obj)
        if (event is ServerEvent.JournalRewritten) since.set(0) // rewrite 收缩 → 全量补拉
        _events.emit(event)
    }
}
