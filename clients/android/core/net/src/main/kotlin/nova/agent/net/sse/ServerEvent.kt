package nova.agent.net.sse

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/** SSE 连接状态（对外 StateFlow，UI 连接指示数据源）。 */
sealed interface SseState {
    data object Idle : SseState
    data object Connecting : SseState
    /** 已收到 ready 帧（积压回放完毕，进入实时流）。 */
    data object Ready : SseState
    data class Reconnecting(val delayMs: Long) : SseState
    data object NeedRelogin : SseState
    data object Closed : SseState
}

/**
 * server SSE 事件分型（契约全集 + Unknown 前向兼容——新 type 不崩、静默透传）。
 * 各字段与 server 各模块 hub.publish 形状一一对应。
 */
sealed interface ServerEvent {
    data class Ready(val conversationId: String?, val backlog: Int) : ServerEvent

    data class Journal(
        val conversationId: String,
        val seq: Long,
        val runSeq: Int,
        val kind: String,
        /** 已解析的 JSON（server 端 JSON.parse 后下发；REST replay 的 payload 字符串需另行二次 parse）。 */
        val payload: JsonElement,
        val definitionVersion: String?,
    ) : ServerEvent

    data class JournalRewritten(val conversationId: String, val lastSeq: Long, val runCount: Int) : ServerEvent

    data class ApprovalRequested(
        val conversationId: String,
        val requestId: String,
        val runSeq: Int,
        val calls: JsonElement,
        val proposal: JsonElement?,
    ) : ServerEvent

    data class ApprovalResolved(
        val conversationId: String,
        val requestId: String,
        val decision: String,
        val comment: String?,
        val decidedBy: String?,
    ) : ServerEvent

    data class LeaseRevoked(val conversationId: String, val reason: String, val deviceId: String?) : ServerEvent

    data class LeaseReleased(val conversationId: String, val deviceId: String?) : ServerEvent

    data class FileChanged(val projectId: String, val path: String, val op: String, val updatedAt: Long?) : ServerEvent

    data class DomainChanged(val projectId: String, val seq: Long, val count: Int) : ServerEvent

    data class Unknown(val type: String, val raw: JsonObject) : ServerEvent

    companion object {
        fun decode(obj: JsonObject): ServerEvent {
            fun str(key: String): String? = (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
            fun long(key: String): Long? = (obj[key] as? JsonPrimitive)?.content?.toLongOrNull()
            fun int(key: String): Int = (obj[key] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
            fun el(key: String): JsonElement? = obj[key]?.takeIf { it !is kotlinx.serialization.json.JsonNull }
            return when (val type = str("type") ?: "unknown") {
                "ready" -> Ready(str("conversationId"), int("backlog"))
                "journal" -> Journal(
                    conversationId = str("conversationId") ?: "",
                    seq = long("seq") ?: 0,
                    runSeq = int("runSeq"),
                    kind = str("kind") ?: "",
                    payload = el("payload") ?: kotlinx.serialization.json.JsonNull,
                    definitionVersion = str("definitionVersion"),
                )
                "journal_rewritten" -> JournalRewritten(str("conversationId") ?: "", long("lastSeq") ?: 0, int("runCount"))
                "approval_requested" -> ApprovalRequested(
                    conversationId = str("conversationId") ?: "",
                    requestId = str("requestId") ?: "",
                    runSeq = int("runSeq"),
                    calls = el("calls") ?: kotlinx.serialization.json.JsonNull,
                    proposal = el("proposal"),
                )
                "approval_resolved" -> ApprovalResolved(
                    conversationId = str("conversationId") ?: "",
                    requestId = str("requestId") ?: "",
                    decision = str("decision") ?: "",
                    comment = str("comment"),
                    decidedBy = str("decidedBy"),
                )
                "lease_revoked" -> LeaseRevoked(str("conversationId") ?: "", str("reason") ?: "", str("deviceId"))
                "lease_released" -> LeaseReleased(str("conversationId") ?: "", str("deviceId"))
                "file_changed" -> FileChanged(
                    projectId = str("projectId") ?: "",
                    path = str("path") ?: "",
                    op = str("op") ?: "",
                    updatedAt = long("updatedAt"),
                )
                "domain_changed" -> DomainChanged(str("projectId") ?: "", long("seq") ?: 0, int("count"))
                else -> Unknown(type, obj)
            }
        }
    }
}
