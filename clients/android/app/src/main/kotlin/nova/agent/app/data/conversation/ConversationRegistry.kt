package nova.agent.app.data.conversation

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID

/** 会话本地元数据（FR3）：projectId 关联是纯客户端概念（server 无会话注册表）。 */
@Serializable
data class ConversationMeta(
    val conversationId: String,
    val projectId: String? = null,
    val title: String = "新会话",
    val createdAt: Long = 0,
    val lastSeq: Long = 0,
    /** 跨端发现（GlobalChannel 未知 cid）：无镜像无 meta，打开时按需 replay + acquire。 */
    val external: Boolean = false,
)

/**
 * 会话发现注册表（FR3，对齐桌面 mirrors 扫描约定）：
 * `filesDir/conversations/<cid>/journal.jsonl`（HttpJournalStore mirrorPath 约定）扫描出会话集，
 * 每会话 meta.json 由创建端写入；新会话 id = `conv-<uuid>`；
 * 会话↔项目关联缺失是契约已知限制（v1.2 会话列表端点），跨端发现的会话挂 external 桶。
 */
class ConversationRegistry(
    private val root: Path,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; prettyPrint = true }

    private val _conversations = MutableStateFlow<List<ConversationMeta>>(emptyList())
    val conversations: StateFlow<List<ConversationMeta>> = _conversations.asStateFlow()

    fun mirrorPath(cid: String): Path = root.resolve(cid).resolve("journal.jsonl")

    fun metaPath(cid: String): Path = root.resolve(cid).resolve("meta.json")

    fun newConversationId(): String = "conv-${UUID.randomUUID()}"

    /** 扫描本地目录（启动/刷新）；容忍缺 meta 的孤儿目录（按 external-lite 处理，标题=cid 短码）。 */
    suspend fun scan(): List<ConversationMeta> = withContext(io) {
        val found = mutableListOf<ConversationMeta>()
        if (Files.isDirectory(root)) {
            Files.list(root).use { stream ->
                stream.filter { Files.isDirectory(it) }.sorted().forEach { dir ->
                    val cid = dir.fileName.toString()
                    val meta = readMeta(cid)
                    found += meta ?: ConversationMeta(
                        conversationId = cid,
                        title = shortCode(cid),
                        createdAt = Files.getLastModifiedTime(dir).toMillis(),
                    )
                }
            }
        }
        // external 登记项保留（无本地目录但已知存在）
        val externals = _conversations.value.filter { it.external && found.none { f -> f.conversationId == it.conversationId } }
        _conversations.value = (found + externals).sortedByDescending { it.createdAt }
        _conversations.value
    }

    /** 创建端登记新会话（落盘 meta + 目录）。 */
    suspend fun register(cid: String, projectId: String, title: String = "新会话"): ConversationMeta = withContext(io) {
        val meta = ConversationMeta(
            conversationId = cid,
            projectId = projectId,
            title = title,
            createdAt = clock(),
        )
        Files.createDirectories(root.resolve(cid))
        writeMeta(meta)
        refresh(cid, meta)
        meta
    }

    /** 跨端发现登记（不落盘；title=cid 短码，无 projectId →「本项目（未关联）」桶由 UI 归组）。 */
    suspend fun addExternal(cid: String): ConversationMeta {
        val existing = _conversations.value.firstOrNull { it.conversationId == cid }
        if (existing != null) return existing
        val meta = ConversationMeta(conversationId = cid, title = shortCode(cid), createdAt = clock(), external = true)
        _conversations.value = (_conversations.value + meta).sortedByDescending { it.createdAt }
        return meta
    }

    /** open() 对账后统一回写 lastSeq（OQ⑤ 落定）；顺带首次定题（首条用户消息前 24 字）。 */
    suspend fun updateAfterOpen(cid: String, lastSeq: Long, title: String? = null) {
        val current = _conversations.value.firstOrNull { it.conversationId == cid } ?: return
        val next = current.copy(lastSeq = lastSeq, title = title ?: current.title, external = current.external && !hasLocal(cid))
        if (next != current) {
            if (!next.external) writeMeta(next)
            refresh(cid, next)
        }
    }

    fun metaOf(cid: String): ConversationMeta? = _conversations.value.firstOrNull { it.conversationId == cid }

    private suspend fun refresh(cid: String, meta: ConversationMeta) {
        _conversations.value = (_conversations.value.filterNot { it.conversationId == cid } + meta)
            .sortedByDescending { it.createdAt }
    }

    private suspend fun hasLocal(cid: String): Boolean = withContext(io) { Files.exists(mirrorPath(cid)) }

    private fun readMeta(cid: String): ConversationMeta? = try {
        val path = metaPath(cid)
        // readAllBytes 而非 readString：Files.readString 需 API 33+，minSdk 26 兼容
        if (Files.exists(path)) json.decodeFromString(ConversationMeta.serializer(), String(Files.readAllBytes(path))) else null
    } catch (_: Exception) {
        null // 损坏按未登记处理（镜像仍在，重建 meta）
    }

    private fun writeMeta(meta: ConversationMeta) {
        Files.write(metaPath(meta.conversationId), json.encodeToString(ConversationMeta.serializer(), meta).toByteArray())
    }

    companion object {
        fun shortCode(cid: String): String = cid.takeLast(8)
    }
}

/**
 * run 触发源（teammate 前瞻，PRD §3）：USER = 本地输入；
 * TASK/REMOTE = 任务载荷/teammate/server 推送（本阶段仅占位，不实现触发路径）。
 * 非用户发起的 run 经 UserEchoed/RunStart 重放路径上屏，不误挂用户气泡。
 */
enum class RunSource { USER, TASK, REMOTE }
