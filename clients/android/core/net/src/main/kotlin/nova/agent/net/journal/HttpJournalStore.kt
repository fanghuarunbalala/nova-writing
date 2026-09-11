package nova.agent.net.journal

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import nova.agent.journal.JournalStore
import nova.agent.model.JournalLine
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.NetworkUnreachableException
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp
import nova.agent.net.mirror.JournalMirror
import nova.agent.net.mirror.MirrorRow
import nova.agent.net.mirror.ReplayResponse
import nova.agent.net.mirror.fetchReplay
import java.nio.file.Path

/** rewrite 409：账本被并发写入，携带 server 当前 lastSeq（客户端重放后重试/人工裁决）。 */
class JournalRewriteConflictException(val currentLastSeq: Long) :
    Exception("账本已被并发写入（rewrite 409），当前 lastSeq=$currentLastSeq，请重放后重试")

/**
 * JournalStore 的 server 实现（契约 §7；桌面端 HttpConversationJournalService 对应物）。
 *
 * 双序号：localSeq（JournalLine.seq，run 级行号，契约测试断言递增）与 serverLastSeq
 * （server 账本全局行号，rewrite 的 expectedLastSeq 基线；POST 201 取 max，PUT 200 直接赋值）。
 *
 * 错误分类（对齐桌面 + 阶段1 PRD 3.4 的「run 不中断」修订）：
 * - 网络失败/5xx → 入积压队后**不抛**（返回本地行，run 继续；溢出才抛 PendingPushOverflowException）；
 * - 4xx（租约/认证/参数）→ 不入队直接抛（重试无意义）；
 * - 镜像写通 = POST 成功后按响应 gs 落行；失败静默（尾序不推进，下次对账自愈）。
 *
 * open() = 对账（replay 增量/收缩判定 + 镜像修补）+ 积压按序补推。
 * readAll() = replay 全量折叠（payload JSON 字符串二次 parse）；离线时回落镜像（只读兜底）。
 */
class HttpJournalStore(
    private val http: ServerHttp,
    private val conversationId: String,
    private val auth: ServerAuthSession,
    private val getLeaseToken: () -> String?,
    private val pending: PendingPushQueue,
    private val mirrorPath: Path? = null,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val clock: () -> Long = System::currentTimeMillis,
) : JournalStore {

    private val mutex = Mutex()
    private val messageListSerializer = ListSerializer(LLMessage.serializer())

    private var localSeq: Long = 0
    private var lastRunSeq: Int = 0
    private var serverLastSeq: Long = 0
    private var mirrorTailGs: Long = 0

    override suspend fun open() = mutex.withLock {
        reconcile()
        drainPending()
    }

    override suspend fun appendSnapshot(
        runSeq: Int,
        messages: List<LLMessage>,
        definitionVersion: String?,
    ): JournalLine.Snapshot = mutex.withLock {
        lastRunSeq = maxOf(lastRunSeq, runSeq)
        postEvent("snapshot", runSeq, messages, definitionVersion)
        JournalLine.Snapshot(++localSeq, runSeq, messages, definitionVersion)
    }

    override suspend fun appendMessages(runSeq: Int, messages: List<LLMessage>): JournalLine.Append = mutex.withLock {
        lastRunSeq = maxOf(lastRunSeq, runSeq)
        postEvent("append", runSeq, messages, null)
        JournalLine.Append(++localSeq, runSeq, messages)
    }

    override suspend fun readAll(): List<StoredRun> {
        val token = requireToken()
        val body = try {
            fetchReplay(http, conversationId, token, since = 0, io = io)
        } catch (e: NetworkUnreachableException) {
            // 离线回落镜像（只读兜底）；无镜像则上抛——server 是唯一权威
            val path = mirrorPath ?: throw e
            return foldRows(JournalMirror.readAllRows(path))
        }
        body ?: run {
            val path = mirrorPath ?: throw NetworkUnreachableException(IllegalStateException("replay 失败"))
            return foldRows(JournalMirror.readAllRows(path))
        }
        return foldReplay(body)
    }

    override suspend fun rewriteAll(runs: List<StoredRun>) {
        mutex.withLock {
            lastRunSeq = runs.maxOfOrNull { it.runSeq } ?: 0
            val token = requireToken()
            val lease = getLeaseToken() ?: throw ServerApiException(0, "lease_required", "缺少租约")
            val body = buildJsonObject {
                put("expectedLastSeq", serverLastSeq)
                put("leaseToken", lease)
                put("runs", JsonArray(runs.map { run ->
                    buildJsonObject {
                        put("runSeq", run.runSeq)
                        put("messages", json.encodeToJsonElement(messageListSerializer, run.messages))
                    }
                }))
            }
            val response = try {
                http.request("PUT", "/v1/journal/$conversationId/rewrite", token, body)
            } catch (e: ServerApiException) {
                if (e.status == 409 && e.code == "stale_rewrite") {
                    val current = (e.extras["currentLastSeq"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 0
                    throw JournalRewriteConflictException(current)
                }
                throw e
            }
            // PUT 200：lastSeq 直接赋值（桌面语义——rewrite 后全局行号重新排布）
            serverLastSeq = response?.get("lastSeq")?.jsonPrimitive?.long ?: 0
            mirrorPath?.let { path ->
                fetchReplay(http, conversationId, token, since = 0, io = io)?.let { full ->
                    JournalMirror.rewriteMirrorRows(path, JournalMirror.mirrorRowsOf(full.events, clock))
                    mirrorTailGs = maxOf(mirrorTailGs, full.lastSeq)
                }
            }
        }
    }

    // ---- 内部：上推 ----

    /** 上推单行事件；返回是否已直达 server（false = 已入积压队）。 */
    private suspend fun postEvent(
        kind: String,
        runSeq: Int,
        messages: List<LLMessage>,
        definitionVersion: String?,
    ): Boolean {
        val messagesJson = json.encodeToString(messageListSerializer, messages)
        val token = try {
            requireToken()
        } catch (e: ServerApiException) {
            throw e // not_logged_in：不入队（补推同样需要 token）
        }
        val lease = getLeaseToken() ?: throw ServerApiException(0, "lease_required", "缺少租约")
        val body = buildJsonObject {
            put("runSeq", runSeq)
            put("kind", kind)
            put("messages", json.encodeToJsonElement(messageListSerializer, messages))
            definitionVersion?.let { put("definitionVersion", it) }
            put("leaseToken", lease)
        }
        return try {
            val response = http.request("POST", "/v1/runs/$conversationId/events", token, body, expect = intArrayOf(201))
            val gs = response?.get("seq")?.jsonPrimitive?.long ?: 0
            serverLastSeq = maxOf(serverLastSeq, gs)
            appendMirror(kind, runSeq, messages, definitionVersion, gs)
            auth.reportRequestSuccess()
            true
        } catch (e: NetworkUnreachableException) {
            auth.reportRequestFailure(e)
            pending.enqueue(conversationId, kind, runSeq, messagesJson)
            false
        } catch (e: ServerApiException) {
            auth.reportRequestFailure(e)
            if (e.status >= 500) {
                pending.enqueue(conversationId, kind, runSeq, messagesJson)
                false
            } else {
                throw e // 4xx：租约/认证/参数错，重试无意义
            }
        }
    }

    private fun appendMirror(kind: String, runSeq: Int, messages: List<LLMessage>, definitionVersion: String?, gs: Long) {
        val path = mirrorPath ?: return
        val row = JournalMirror.mirrorRowOf(kind, runSeq, messages, definitionVersion, gs, clock)
        if (JournalMirror.appendMirrorRows(path, listOf(row)) > 0) {
            mirrorTailGs = maxOf(mirrorTailGs, gs)
        }
    }

    private suspend fun requireToken(): String =
        auth.ensureAccessToken() ?: throw ServerApiException(0, "not_logged_in", "server 未登录")

    // ---- 内部：open 的对账与补推 ----

    private suspend fun reconcile() {
        val token = auth.ensureAccessToken() ?: return // 离线/未登录：无操作（积压留在队里）
        val path = mirrorPath
        if (path != null) {
            val fileTail = JournalMirror.readMirrorTail(path)
            val tail = maxOf(mirrorTailGs, fileTail.gs)
            lastRunSeq = maxOf(lastRunSeq, fileTail.runSeq)
            val body = fetchReplay(http, conversationId, token, since = tail, io = io) ?: return
            if (body.lastSeq < tail) {
                // 账本被 rewrite 收缩 → 全量重建镜像
                val full = fetchReplay(http, conversationId, token, since = 0, io = io) ?: return
                JournalMirror.rewriteMirrorRows(path, JournalMirror.mirrorRowsOf(full.events, clock))
                mirrorTailGs = full.lastSeq
                serverLastSeq = maxOf(serverLastSeq, full.lastSeq)
                full.events.forEach { lastRunSeq = maxOf(lastRunSeq, it.runSeq) }
            } else {
                val fresh = body.events.filter { it.seq > tail }
                val appended = JournalMirror.appendMirrorRows(path, JournalMirror.mirrorRowsOf(fresh, clock))
                if (appended > 0) mirrorTailGs = maxOf(mirrorTailGs, body.lastSeq)
                serverLastSeq = maxOf(serverLastSeq, body.lastSeq)
                body.events.forEach { lastRunSeq = maxOf(lastRunSeq, it.runSeq) }
            }
        } else {
            val body = fetchReplay(http, conversationId, token, since = 0, io = io) ?: return
            body.events.forEach {
                serverLastSeq = maxOf(serverLastSeq, it.seq)
                lastRunSeq = maxOf(lastRunSeq, it.runSeq)
            }
        }
    }

    private suspend fun drainPending() {
        val rows = pending.drainAll(conversationId)
        if (rows.isEmpty()) return
        val token = auth.ensureAccessToken() ?: return
        val sentIds = mutableListOf<Long>()
        for (row in rows) {
            val lease = getLeaseToken() ?: break
            val ok = tryPostDirect(row, token, lease)
            if (!ok) break // 保序：失败即停，剩余保留
            sentIds += row.id
        }
        pending.removeSent(sentIds)
    }

    /** 直推（不落队不抛）：201 → serverLastSeq 推进 + 镜像落行。 */
    private suspend fun tryPostDirect(row: PendingRow, token: String, lease: String): Boolean = try {
        val body = buildJsonObject {
            put("runSeq", row.runSeq)
            put("kind", row.kind)
            put("messages", json.parseToJsonElement(row.messagesJson))
            put("leaseToken", lease)
        }
        val response = http.request("POST", "/v1/runs/$conversationId/events", token, body, expect = intArrayOf(201))
        val gs = response?.get("seq")?.jsonPrimitive?.long ?: 0
        serverLastSeq = maxOf(serverLastSeq, gs)
        if (row.kind == "snapshot" || row.kind == "append") {
            val messages = runCatching { json.decodeFromString(messageListSerializer, row.messagesJson) }.getOrNull()
            if (messages != null) appendMirror(row.kind, row.runSeq, messages, null, gs)
        }
        true
    } catch (_: Exception) {
        false
    }

    // ---- 内部：折叠 ----

    private fun foldReplay(body: ReplayResponse): List<StoredRun> {
        val runs = LinkedHashMap<Int, StoredRun>()
        body.events
            .filter { it.kind == "snapshot" || it.kind == "append" }
            .forEach { e ->
                // M3 已修的坑：payload 是 JSON 字符串，需二次 parse
                val messages = runCatching { json.decodeFromString(messageListSerializer, e.payload) }.getOrNull() ?: return@forEach
                if (e.kind == "snapshot") {
                    runs[e.runSeq] = StoredRun(e.runSeq).apply {
                        append(messages)
                        definitionVersion = e.definitionVersion
                    }
                } else {
                    runs.getOrPut(e.runSeq) { StoredRun(e.runSeq) }.append(messages)
                }
            }
        runs.values.forEach { it.detectSummary() }
        return runs.values.toList()
    }

    private fun foldRows(rows: List<MirrorRow>): List<StoredRun> {
        val runs = LinkedHashMap<Int, StoredRun>()
        rows.forEach { row ->
            if (row.kind == "snapshot") {
                runs[row.seq] = StoredRun(row.seq).apply {
                    append(row.messages)
                    definitionVersion = row.definitionVersion
                }
            } else {
                runs.getOrPut(row.seq) { StoredRun(row.seq) }.append(row.messages)
            }
        }
        runs.values.forEach { it.detectSummary() }
        return runs.values.toList()
    }

    /** 摘要 run 的内容级标记检测（与 Jsonl/Room 实现一致）：单条 user 消息以 <context-summary 开头。 */
    private fun StoredRun.detectSummary() {
        summarized = messages.size == 1 &&
            (messages[0] as? LLMessage.User)?.content?.startsWith("<context-summary") == true
    }
}
