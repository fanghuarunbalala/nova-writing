package nova.agent.app.data.conversation

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun

/**
 * 账本 → LoopEvent 投影（FR6 只读分支 + FR4 历史折叠共用）：
 * 持有端与只读端共用同一 mapLoopEvent 管线，只读端完整复刻持有端 UI。
 *
 * 顺序对齐 runtime 发射序：AssistantMessage 先于其工具行；UserMessage 走 UserEchoed
 * 幂等路径（u-r<runSeq>，与交互 Submitted 去重——teammate/远端 run 不误挂本地气泡）。
 * RunEnd 不落 journal：终判 = 末条 assistant 为 STOP 且无 toolCalls → 合成 COMPLETED；
 * 进行中的 run（他端正在写）不合成 → 只读端呈「生成中」，与真实进度一致。
 */
object JournalProjector {

    private val json = Json { ignoreUnknownKeys = true }
    private val messageList = ListSerializer(LLMessage.serializer())

    /** SSE journal 事件 payload（数组直载或字符串二载）→ 消息列表；坏载荷返回空。 */
    fun parseMessages(payload: JsonElement): List<LLMessage> = try {
        when (payload) {
            is JsonArray -> json.decodeFromJsonElement(messageList, payload)
            is JsonPrimitive -> if (payload.isString) json.decodeFromString(messageList, payload.content) else emptyList()
            else -> emptyList()
        }
    } catch (_: Exception) {
        emptyList()
    }

    /** 整 run 折叠（history 分页 / 首屏打开）。 */
    fun runEvents(cid: String, run: StoredRun): List<LoopEvent> = buildList {
        add(LoopEvent.RunStart(cid, run.runSeq))
        run.messages.forEach { addAll(messageEvents(cid, run.runSeq, it)) }
        terminalContent(run.messages)?.let { add(LoopEvent.RunEnd(cid, run.runSeq, RunEndReason.COMPLETED, finalContent = it)) }
    }

    /** 单行折叠（SSE journal 增量：snapshot=RunStart 开号 + 消息；append=消息）。 */
    fun rowEvents(cid: String, runSeq: Int, kind: String, messages: List<LLMessage>): List<LoopEvent> = buildList {
        if (kind == "snapshot") add(LoopEvent.RunStart(cid, runSeq))
        messages.forEach { addAll(messageEvents(cid, runSeq, it)) }
    }

    fun messageEvents(cid: String, runSeq: Int, message: LLMessage): List<LoopEvent> = when (message) {
        is LLMessage.User -> listOf(LoopEvent.UserMessage(cid, runSeq, message.content))
        is LLMessage.Assistant -> buildList {
            add(LoopEvent.AssistantMessage(cid, runSeq, message))
            // 工具行随消息（重放视觉序：文本块 → 工具行；ToolStarted/Finished 幂等）
            message.toolCalls.forEach { add(LoopEvent.ToolCallRequest(cid, runSeq, it)) }
        }
        is LLMessage.Tool -> listOf(
            LoopEvent.ToolCallResponse(cid, runSeq, message.toolCallId, message.name, content = message.content)
        )
        is LLMessage.System -> emptyList() // nudge/摘要标记无 UI 表现
    }

    /** 终判：末条消息为 STOP 收口的 assistant（无悬挂工具）→ 返回 finalContent。 */
    private fun terminalContent(messages: List<LLMessage>): String? {
        val last = messages.lastOrNull() as? LLMessage.Assistant ?: return null
        if (last.toolCalls.isNotEmpty()) return null
        return last.content.ifBlank { null }
    }

    /** 行级终判（SSE 增量路径用）：消息列表已收口则返回 finalContent，否则 null。 */
    fun terminalOf(messages: List<LLMessage>): String? = terminalContent(messages)
}
