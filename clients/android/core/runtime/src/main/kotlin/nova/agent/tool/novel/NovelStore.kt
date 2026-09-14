package nova.agent.tool.novel

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.putJsonArray
import nova.agent.model.ToolCall
import nova.agent.tool.ToolContext
import nova.agent.tool.ToolDef
import nova.agent.tool.ToolErrorCode
import nova.agent.tool.ToolException

/**
 * 段落实体（M4 阶段3 从 InMemoryNovelStore 嵌套类升为顶层）：
 * 每实体带 entity_version 乐观锁，mutation 携带 baseRevision，
 * checkRevision 不匹配即拒绝并报出当前版本（让模型重读自纠）。
 */
data class NovelParagraph(
    val id: String,
    var storyUnitId: String,
    var orderKey: Int,
    var text: String,
    var entityVersion: Int = 1,
)

/**
 * 小说库端口（M4 阶段3）：工具层只依赖本接口。
 * - [InMemoryNovelStore]：进程内实现（演示/JVM 测试）；
 * - :core:net 的 RemoteNovelStore：云项目 novel 域投影 + oplog 上推（write/delete 经乐观锁）。
 * 双实现同契约（NovelStoreContractTest）：write 未知 id 即新建、delete 未知 id 抛错、
 * baseRevision 过期抛 [ToolException]（PRECHECK_FAILED）。
 */
interface NovelStore {
    suspend fun query(storyUnitId: String? = null): List<NovelParagraph>

    suspend fun paragraph(id: String): NovelParagraph?

    suspend fun write(id: String, storyUnitId: String, orderKey: Int, text: String, baseRevision: Int?): String

    suspend fun delete(id: String, baseRevision: Int?): String
}

/**
 * 内存小说库 + 演示工具（M1）。
 *
 * 平移桌面端 SqliteNovelStore 的核心语义；M2 起 :core:data 提供 Room 版实现，
 * M4 阶段3 抽出 [NovelStore] 接口供 RemoteNovelStore 复用工具层，工具 handler 不变。
 */
class InMemoryNovelStore : NovelStore {

    private val paragraphs = LinkedHashMap<String, NovelParagraph>()
    var mutationCount: Int = 0
        private set

    override suspend fun query(storyUnitId: String?): List<NovelParagraph> =
        paragraphs.values.filter { storyUnitId == null || it.storyUnitId == storyUnitId }

    override suspend fun paragraph(id: String): NovelParagraph? = paragraphs[id]

    private fun checkRevision(id: String, baseRevision: Int?) {
        val current = paragraphs[id] ?: return
        if (baseRevision != null && baseRevision != current.entityVersion) {
            throw ToolException(
                ToolErrorCode.PRECHECK_FAILED,
                "实体 ${id} 已更新到 v${current.entityVersion}，基于 v${baseRevision} 的修改已过期，请重读最新内容后再改",
            )
        }
    }

    override suspend fun write(id: String, storyUnitId: String, orderKey: Int, text: String, baseRevision: Int?): String {
        checkRevision(id, baseRevision)
        val existing = paragraphs[id]
        val newVersion = (existing?.entityVersion ?: 0) + 1
        if (existing != null) {
            existing.storyUnitId = storyUnitId
            existing.orderKey = orderKey
            existing.text = text
            existing.entityVersion = newVersion
        } else {
            paragraphs[id] = NovelParagraph(id, storyUnitId, orderKey, text, entityVersion = newVersion)
        }
        mutationCount++
        return "已写入段落 $id（v$newVersion，storyUnit=$storyUnitId，orderKey=$orderKey，${text.length} 字）"
    }

    override suspend fun delete(id: String, baseRevision: Int?): String {
        val existing = paragraphs[id]
            ?: throw ToolException(ToolErrorCode.PRECHECK_FAILED, "段落 $id 不存在")
        checkRevision(id, baseRevision)
        paragraphs.remove(id)
        mutationCount++
        return "已删除段落 $id（原版本 v${existing.entityVersion}）"
    }
}

private val paragraphSchema = buildJsonObject {
    put("type", "object")
    putJsonObject("properties") {
        putJsonObject("id") { put("type", "string"); put("description", "段落 id，新建可省略") }
        putJsonObject("storyUnitId") { put("type", "string"); put("description", "所属故事单元 id") }
        putJsonObject("orderKey") { put("type", "integer"); put("description", "段落序号") }
        putJsonObject("text") { put("type", "string"); put("description", "段落正文") }
        putJsonObject("baseRevision") { put("type", "integer"); put("description", "基于的实体版本号（乐观锁），新建省略") }
    }
    putJsonArray("required") {}
}

private fun JsonObject.str(key: String): String? =
    (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.int(key: String): Int? =
    (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull()

/** 组装域工具集（M4 阶段3 store 参数接口化）：读大纲（免审）+ 写/删段落（需审批 + 乐观锁预检）。 */
fun novelTools(store: NovelStore): List<ToolDef> {
    val readOutline = ToolDef(
        name = "novel_read_outline",
        description = "读取小说大纲：列出段落 id、版本号、序号与正文预览。修改前先读，拿最新 entity_version。",
        parameters = buildJsonObject {
            put("type", "object")
            putJsonObject("properties") {
                putJsonObject("storyUnitId") { put("type", "string"); put("description", "可选，按故事单元过滤") }
            }
        },
        handler = { req, _ ->
            val unit = req.args.str("storyUnitId")
            val all = store.query(unit)
            if (all.isEmpty()) "（该范围暂无段落）" else all.joinToString("\n") { p ->
                "[${p.id}] v${p.entityVersion} unit=${p.storyUnitId} order=${p.orderKey}: ${p.text.take(80)}"
            }
        },
    )

    val writeParagraph = ToolDef(
        name = "novel_write_paragraph",
        description = "写入/更新一个段落。修改已有段落必须带 baseRevision（来自 novel_read_outline 的最新版本号）。",
        parameters = paragraphSchema,
        requireApproval = true,
        precheck = { req ->
            val id = req.args.str("id")
            val base = req.args.int("baseRevision")
            if (id != null && base != null) {
                val current = store.paragraph(id)
                if (current != null && current.entityVersion != base) {
                    throw ToolException(
                        ToolErrorCode.PRECHECK_FAILED,
                        "实体 $id 已更新到 v${current.entityVersion}，基于 v$base 的修改已过期",
                    )
                }
            }
        },
        handler = { req, _ ->
            val id = req.args.str("id") ?: "p-${store.query().size + 1}"
            val storyUnitId = req.args.str("storyUnitId")
                ?: throw ToolException(ToolErrorCode.ARGUMENTS_INVALID, "缺少必填参数 storyUnitId")
            val orderKey = req.args.int("orderKey")
                ?: throw ToolException(ToolErrorCode.ARGUMENTS_INVALID, "缺少必填参数 orderKey")
            val text = req.args.str("text")
                ?: throw ToolException(ToolErrorCode.ARGUMENTS_INVALID, "缺少必填参数 text")
            store.write(id, storyUnitId, orderKey, text, req.args.int("baseRevision"))
        },
    )

    val deleteParagraph = ToolDef(
        name = "novel_delete_paragraph",
        description = "删除一个段落（乐观锁同上，需 id 与 baseRevision）。",
        parameters = buildJsonObject {
            put("type", "object")
            putJsonObject("properties") {
                putJsonObject("id") { put("type", "string") }
                putJsonObject("baseRevision") { put("type", "integer") }
            }
        },
        requireApproval = true,
        handler = { req, _ ->
            val id = req.args.str("id")
                ?: throw ToolException(ToolErrorCode.ARGUMENTS_INVALID, "缺少必填参数 id")
            store.delete(id, req.args.int("baseRevision"))
        },
    )

    return listOf(readOutline, writeParagraph, deleteParagraph)
}

/** 测试便捷构造。 */
fun toolCallOf(id: String, name: String, argsJson: String): ToolCall = ToolCall(id, name, argsJson)
