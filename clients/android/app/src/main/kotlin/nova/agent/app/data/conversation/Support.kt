package nova.agent.app.data.conversation

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import nova.agent.app.data.ChatItem
import nova.agent.app.data.ChatUiState
import nova.agent.app.data.mapLoopEvent
import nova.agent.app.data.reduce
import nova.agent.loop.LoopEvent
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.provider.Provider
import nova.agent.provider.ProviderErrorKind
import nova.agent.provider.ProviderException
import nova.agent.provider.ProviderRequest
import nova.agent.provider.ProviderResult

/**
 * run 粒度历史分页 fold（FR4，客户端读侧契约——server 无对应端点）：
 * 首屏 latest N=8 runs；上翻 before=已载最早 runSeq；limit+1 探测 hasMore。
 * 投影复用 mapLoopEvent + reducer（UserEchoed 幂等 id 与实时路径一致）。
 */
class HistoryPaging(private val pageSize: Int = 8) {

    private var earliestRunSeq: Int? = null
    private val loadedRuns = mutableSetOf<Int>()

    /** 取下一页（history 全量在内存，分页是折叠窗口）；无更多返回 null。 */
    fun nextPage(history: List<StoredRun>, conversationId: String = "replayed"): Page? {
        val runsDesc = history.sortedByDescending { it.runSeq }.filter { it.runSeq !in loadedRuns }
        if (runsDesc.isEmpty()) return null
        val window = when (val earliest = earliestRunSeq) {
            null -> runsDesc.take(pageSize + 1)
            else -> runsDesc.filter { it.runSeq < earliest }.take(pageSize + 1)
        }
        val hasMore = window.size > pageSize
        val page = if (hasMore) window.dropLast(1) else window
        if (page.isEmpty()) return null
        page.forEach { loadedRuns += it.runSeq }
        earliestRunSeq = page.minOf { it.runSeq }

        // 投影复用 mapLoopEvent + reducer（跨 run 共享 scratch，localId 连续）
        var acc = ChatUiState()
        page.sortedBy { it.runSeq }.forEach { run ->
            JournalProjector.runEvents(conversationId, run).forEach { e ->
                mapLoopEvent(e) { 0L }?.let { acc = acc.reduce(it) }
            }
        }
        return Page(prepend = acc.items, hasMore = hasMore)
    }

    data class Page(val prepend: List<ChatItem>, val hasMore: Boolean)
}

/**
 * BYOK 懒 Provider（FR9）：会话可在未配置模型时打开（历史/只读照常），
 * 首次推理才取配置；未配置 → AUTH 类 ProviderException（run 收口 FAILED，文案进横幅）。
 */
class LazyProvider(private val factory: suspend () -> Provider?) : Provider {
    override suspend fun call(request: ProviderRequest, onDelta: suspend (nova.agent.provider.ProviderDelta) -> Unit): ProviderResult {
        val provider = factory() ?: throw ProviderException(ProviderErrorKind.AUTH, "未配置模型（BYOK）——请在「设置 → 自带密钥」填写 Provider 与 API Key")
        return provider.call(request, onDelta)
    }
}

/** SSE approval_requested.calls（JsonElement：数组直载或字符串二载）→ ToolCall 列表；坏载荷空表。 */
fun parseToolCalls(payload: kotlinx.serialization.json.JsonElement): List<nova.agent.model.ToolCall> = try {
    val json = Json { ignoreUnknownKeys = true }
    when (payload) {
        is kotlinx.serialization.json.JsonArray ->
            json.decodeFromJsonElement(ListSerializer(nova.agent.model.ToolCall.serializer()), payload)
        is kotlinx.serialization.json.JsonPrimitive -> if (payload.isString) {
            json.decodeFromString(ListSerializer(nova.agent.model.ToolCall.serializer()), payload.content)
        } else emptyList()
        else -> emptyList()
    }
} catch (_: Exception) {
    emptyList()
}
