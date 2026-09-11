package nova.agent.net.project

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import nova.agent.net.mirror.JournalMirror
import nova.agent.tool.novel.InMemoryNovelStore
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.UUID

/** M4 段落级域变更（Kotlin 运行时 InMemoryNovelStore 的可序列化形态；桌面 NovelMutation 的子集）。 */
@Serializable
data class NovelMutation(
    val op: String, // write | delete
    val id: String,
    val storyUnitId: String? = null,
    val orderKey: Int? = null,
    val text: String? = null,
    val baseRevision: Int? = null,
)

/**
 * 云项目 novel 域后端（契约 §5；桌面 RemoteNovelStore 对应物）——投影 + oplog 复制：
 * - 本地投影 = InMemoryNovelStore（乐观锁等域语义原样）；
 * - server 权威 = 每个成功 mutation 一条 oplog 实体（kind=novel_mutation，data 含 sessionTag）；
 * - 收敛：init 缓存命中或 snapshot 全量 → query 前 delta 增量重放（sessionTag 自身条目跳过——
 *   **sessionTag 必须进程内唯一**，固定值会让重启后的空投影跳过自身旧操作 → 丢数据）；
 * - 上推失败抛错（本地发散不传播；下次会话从 server 重放收敛）。
 */
class RemoteNovelStore(
    private val projects: CloudProjectsClient,
    private val projectId: String,
    private val sessionTag: String,
    private val getLeaseToken: () -> String?,
    private val getConversationId: () -> String,
    private val cachePath: Path? = null,
    private val onReplaySkip: (NovelMutation, Throwable) -> Unit = { _, _ -> },
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    @Serializable
    data class OplogData(val sessionTag: String, val mutation: NovelMutation)

    @Serializable
    data class OplogEntity(val id: String, val kind: String, val seq: Long, val data: OplogData)

    @Serializable
    data class SnapshotCache(val version: Int = 1, val cursor: Long = 0, val entities: List<OplogEntity> = emptyList())

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val projection = InMemoryNovelStore()
    private val entities = mutableListOf<OplogEntity>()
    private var cursor: Long = 0
    private var ready = false

    suspend fun init() {
        if (ready) return
        if (loadCache()) {
            ready = true
            return
        }
        val snapshot = projects.domainSnapshot(projectId)
        entities.clear()
        entities += snapshot.entities.filter { it.kind == OPLOG_KIND }.map { decodeOplog(it) }.filterNotNull()
        replay(entities.toList())
        cursor = snapshot.cursor
        ready = true
        persistCache()
    }

    suspend fun query(storyUnitId: String? = null): List<InMemoryNovelStore.Paragraph> {
        init()
        sync()
        return projection.list(storyUnitId)
    }

    suspend fun paragraph(id: String): InMemoryNovelStore.Paragraph? {
        init()
        sync()
        return projection.get(id)
    }

    suspend fun mutate(mutation: NovelMutation): String {
        init()
        val result = applyLocal(mutation)
        upload(listOf(mutation))
        return result
    }

    suspend fun mutateBatch(mutations: List<NovelMutation>): List<String> {
        init()
        val results = mutations.map { applyLocal(it) }
        upload(mutations)
        return results
    }

    // ---- 收敛 ----

    private suspend fun sync() {
        val delta = projects.domainDelta(projectId, since = cursor)
        val fresh = delta.entities.filter { it.kind == OPLOG_KIND }.map { decodeOplog(it) }.filterNotNull()
        if (delta.entities.isNotEmpty()) entities += fresh
        replay(fresh)
        cursor = delta.cursor
        if (delta.entities.isNotEmpty()) persistCache()
    }

    private fun replay(rows: List<OplogEntity>) {
        rows.forEach { e ->
            if (e.seq > cursor) cursor = e.seq
            if (e.kind != OPLOG_KIND) return@forEach
            if (e.data.sessionTag == sessionTag) return@forEach // 本会话已应用
            try {
                applyLocal(e.data.mutation)
            } catch (cause: Throwable) {
                onReplaySkip(e.data.mutation, cause) // 前向兼容：坏条目跳过不崩
            }
        }
    }

    private fun applyLocal(m: NovelMutation): String = when (m.op) {
        "write" -> projection.write(
            id = m.id,
            storyUnitId = m.storyUnitId ?: throw IllegalArgumentException("write 需要 storyUnitId"),
            orderKey = m.orderKey ?: throw IllegalArgumentException("write 需要 orderKey"),
            text = m.text ?: throw IllegalArgumentException("write 需要 text"),
            baseRevision = m.baseRevision,
        )
        "delete" -> projection.delete(m.id, m.baseRevision)
        else -> throw IllegalArgumentException("未知 op: ${m.op}")
    }

    /** oplog 上推（批一次上行）；成功后 sync 一次拉回自身操作（sessionTag 跳过、cursor 前进）+ 立即落缓存。 */
    private suspend fun upload(mutations: List<NovelMutation>) {
        val domainMutations = mutations.map { m ->
            DomainMutation(
                kind = OPLOG_KIND,
                id = "m_${UUID.randomUUID()}",
                op = "put",
                data = json.encodeToJsonElement(OplogData.serializer(), OplogData(sessionTag, m)),
            )
        }
        projects.domainMutate(projectId, getConversationId(), getLeaseToken(), domainMutations)
        sync()
        persistCache()
    }

    // ---- 域快照缓存（tmp+rename 原子写；损坏按未命中回退全量） ----

    private fun loadCache(): Boolean {
        val path = cachePath ?: return false
        return try {
            val parsed = json.decodeFromString(SnapshotCache.serializer(), Files.readString(path))
            if (parsed.version != 1) return false
            entities.clear()
            entities += parsed.entities
            cursor = 0
            replay(parsed.entities)
            true
        } catch (_: Exception) {
            false
        }
    }

    private suspend fun persistCache() {
        val path = cachePath ?: return
        withContext(io) {
            try {
                Files.createDirectories(path.toAbsolutePath().parent)
                val tmp = path.resolveSibling(path.fileName.toString() + ".tmp")
                Files.writeString(
                    tmp,
                    json.encodeToString(SnapshotCache.serializer(), SnapshotCache(cursor = cursor, entities = entities.toList())),
                )
                Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
            } catch (_: Exception) {
                // 静默：缓存是派生数据，delta 自愈
            }
        }
    }

    private fun decodeOplog(entity: DomainEntity): OplogEntity? = try {
        // OplogEntity 的 id/kind/seq 来自域实体行本身,data 只解码 {sessionTag, mutation}
        OplogEntity(
            id = entity.id,
            kind = entity.kind,
            seq = entity.seq,
            data = json.decodeFromJsonElement(OplogData.serializer(), entity.data),
        )
    } catch (_: Exception) {
        null
    }

    companion object {
        const val OPLOG_KIND = "novel_mutation"

        /** sessionTag 进程唯一构造（契约 §5）：`<conversationId>-<uuid>`。 */
        fun newSessionTag(conversationId: String): String = "$conversationId-${UUID.randomUUID()}"
    }
}
