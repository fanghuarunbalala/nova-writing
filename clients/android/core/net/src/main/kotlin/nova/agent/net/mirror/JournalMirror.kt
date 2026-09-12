package nova.agent.net.mirror

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import nova.agent.model.LLMessage
import nova.agent.net.http.NetworkUnreachableException
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption

/**
 * journal 本地镜像（契约 §5 / 桌面端 journalMirror.ts 对应物）：
 * 行协议与本地 journal 同构 + 行内嵌 gs（server 账本全局行号，读侧忽略；
 * 做增量游标与多写者去重键）。镜像仅供读侧（UI 回显/离线只读/恢复兜底），不参与写决策。
 */
@Serializable
data class MirrorRow(
    /** runSeq（与桌面 MirrorRow.seq 同义：读侧按 run 折叠）。 */
    val seq: Int,
    /** snapshot | append */
    val kind: String,
    val messages: List<LLMessage>,
    val definitionVersion: String? = null,
    val ts: Long,
    val gs: Long,
)

/** server replay 响应行（snake_case；payload 是 JSON 字符串，需二次 parse——M3 已修的坑）。 */
@Serializable
data class ReplayRow(
    val seq: Long = 0,
    @SerialName("conversation_id") val conversationId: String = "",
    @SerialName("run_seq") val runSeq: Int = 0,
    val kind: String = "",
    val payload: String = "[]",
    @SerialName("definition_version") val definitionVersion: String? = null,
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class ReplayResponse(val events: List<ReplayRow> = emptyList(), val lastSeq: Long = 0)

data class MirrorTail(val gs: Long, val runSeq: Int)

object JournalMirror {

    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val messageListSerializer = ListSerializer(LLMessage.serializer())

    /** 尾扫：从尾向前找第一条完好行（gs 与 seq 均为合法数）；损坏/半行跳过——写到一半崩溃的残留。 */
    fun readMirrorTail(path: Path): MirrorTail = try {
        if (!Files.exists(path)) MirrorTail(0, 0)
        else {
            val lines = Files.readAllLines(path)
            var tail = MirrorTail(0, 0)
            for (i in lines.indices.reversed()) {
                val line = lines[i]
                if (line.isBlank()) continue
                val row = runCatching { json.decodeFromString(MirrorRow.serializer(), line) }.getOrNull() ?: continue
                tail = MirrorTail(gs = row.gs, runSeq = row.seq)
                break
            }
            tail
        }
    } catch (_: Exception) {
        MirrorTail(0, 0)
    }

    /**
     * 追加（gs 严格大于尾序才写——多写者竞态安全，同 gs 行只落一次）。
     * 写失败静默返回 0：镜像是派生数据，尾序未推进，下次增量自然重拉。
     */
    fun appendMirrorRows(path: Path, rows: List<MirrorRow>): Int {
        if (rows.isEmpty()) return 0
        val tail = readMirrorTail(path)
        val fresh = rows.filter { it.gs > tail.gs }
        if (fresh.isEmpty()) return 0
        return try {
            Files.createDirectories(path.toAbsolutePath().parent)
            Files.write(
                // Files.writeString 需 API 33+（真机 NoSuchMethodError 实证），write(bytes) API 26 安全
                path,
                fresh.joinToString("\n", postfix = "\n") { json.encodeToString(MirrorRow.serializer(), it) }.toByteArray(),
                StandardOpenOption.APPEND, StandardOpenOption.CREATE,
            )
            fresh.size
        } catch (_: Exception) {
            0
        }
    }

    /** 全量重建（rewrite/收缩后）；写失败静默。 */
    fun rewriteMirrorRows(path: Path, rows: List<MirrorRow>) {
        try {
            Files.createDirectories(path.toAbsolutePath().parent)
            Files.write(path, rows.joinToString("\n", postfix = "\n") { json.encodeToString(MirrorRow.serializer(), it) }.toByteArray())
        } catch (_: Exception) {
            // 静默：下次对账自愈
        }
    }

    fun readAllRows(path: Path): List<MirrorRow> = try {
        if (!Files.exists(path)) emptyList()
        else Files.readAllLines(path).mapNotNull { line ->
            if (line.isBlank()) null
            else runCatching { json.decodeFromString(MirrorRow.serializer(), line) }.getOrNull()
        }
    } catch (_: Exception) {
        emptyList()
    }

    /** replay 行 → 镜像行：只留 snapshot/append（domain-mutation/memory-write 等不入镜像）；payload 二次 parse，坏行跳过。 */
    fun mirrorRowsOf(events: List<ReplayRow>, ts: () -> Long): List<MirrorRow> = events.mapNotNull { e ->
        if (e.kind != "snapshot" && e.kind != "append") return@mapNotNull null
        val messages = runCatching { json.decodeFromString(messageListSerializer, e.payload) }.getOrNull() ?: return@mapNotNull null
        MirrorRow(
            seq = e.runSeq,
            kind = e.kind,
            messages = messages,
            definitionVersion = e.definitionVersion,
            ts = ts(),
            gs = e.seq,
        )
    }

    fun mirrorRowOf(kind: String, runSeq: Int, messages: List<LLMessage>, definitionVersion: String?, gs: Long, ts: () -> Long): MirrorRow =
        MirrorRow(seq = runSeq, kind = kind, messages = messages, definitionVersion = definitionVersion, ts = ts(), gs = gs)
}

/**
 * replay 拉取（镜像路径专用）：任何失败返回 null，调用方按离线处理（对齐桌面 fetchReplayRows）。
 * 注意与 HttpJournalStore.readAll 的严格路径区分——那里 4xx 需要抛。
 */
suspend fun fetchReplay(
    http: ServerHttp,
    conversationId: String,
    accessToken: String,
    since: Long,
    io: CoroutineDispatcher = Dispatchers.IO,
): ReplayResponse? = withContext(io) {
    try {
        val path = if (since > 0) "/v1/journal/$conversationId/replay?since=$since" else "/v1/journal/$conversationId/replay"
        val body = http.request("GET", path, accessToken) ?: return@withContext null
        val events = body["events"]?.let { el ->
            runCatching { Json.decodeFromJsonElement(ListSerializer(ReplayRow.serializer()), el) }.getOrDefault(emptyList())
        } ?: emptyList()
        val lastSeq = ((body["lastSeq"] as? JsonPrimitive)?.content?.toLongOrNull())
            ?: events.maxOfOrNull { it.seq } ?: 0
        ReplayResponse(events, lastSeq)
    } catch (_: Exception) {
        null
    }
}

/**
 * 预播种（main 侧/打开会话时）：尾扫 → 增量拉 → 收缩判定 → 全量重建或去重追加。
 * 所有失败内部静默（fire-and-forget 语义，对齐桌面 seedJournalMirrorFromServer）。
 */
suspend fun seedJournalMirrorFromServer(
    http: ServerHttp,
    conversationId: String,
    mirrorPath: Path,
    getAccessToken: suspend () -> String?,
    ts: () -> Long = System::currentTimeMillis,
) {
    val token = getAccessToken() ?: return
    val tail = JournalMirror.readMirrorTail(mirrorPath)
    val body = fetchReplay(http, conversationId, token, since = tail.gs) ?: return
    if (body.lastSeq < tail.gs) {
        // 他端 rewrite 收缩/清空 → 全量重建
        val full = fetchReplay(http, conversationId, token, since = 0) ?: return
        JournalMirror.rewriteMirrorRows(mirrorPath, JournalMirror.mirrorRowsOf(full.events, ts))
    } else {
        JournalMirror.appendMirrorRows(mirrorPath, JournalMirror.mirrorRowsOf(body.events, ts))
    }
}
