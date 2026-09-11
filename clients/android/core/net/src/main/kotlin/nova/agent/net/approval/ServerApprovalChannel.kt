package nova.agent.net.approval

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nova.agent.approval.ApprovalDecision
import nova.agent.approval.ApprovalGate
import nova.agent.approval.ApprovalRequest
import nova.agent.model.ToolCall
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp
import nova.agent.net.sse.ServerEvent

/** GET /v1/approvals 行（server ApprovalRow snake_case；calls_json 是字符串需二次 parse）。 */
@Serializable
data class ApprovalRecord(
    @SerialName("request_id") val requestId: String,
    @SerialName("conversation_id") val conversationId: String,
    @SerialName("run_seq") val runSeq: Int = 0,
    val status: String,
    val comment: String? = null,
    @SerialName("decided_by") val decidedBy: String? = null,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("decided_at") val decidedAt: Long? = null,
    @SerialName("calls_json") val callsJson: String = "[]",
) {
    val calls: List<ToolCall>
        get() = runCatching {
            callsJsonCodec.decodeFromString(ListSerializer(ToolCall.serializer()), callsJson)
        }.getOrDefault(emptyList())

    companion object {
        private val callsJsonCodec = Json { ignoreUnknownKeys = true }
    }
}

/**
 * 审批两段式通道（PRD FR6）：征询落库（POST）→ SSE 广播 → 任意端 resolve → 广播决议。
 * 「手机挂起、桌面批」由此成立；本地 120s 超时与 server APPROVAL_TIMEOUT_MS 懒过期一致。
 *
 * 已知边界：server GET /v1/approvals 按 conversationId 过滤（空 cid 返回空）——
 * 跨会话审批中心靠 SSE 全局订阅的实时事件聚合，离线全量列表需契约扩展（v1.2）。
 */
class ServerApprovalChannel(
    private val http: ServerHttp,
    private val auth: ServerAuthSession,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {

    /** 征询上 server（201；server ON CONFLICT DO NOTHING 幂等——重试安全）。失败抛 ServerApiException。 */
    suspend fun report(
        conversationId: String,
        runSeq: Int,
        requestId: String,
        calls: List<ToolCall>,
        leaseToken: String?,
    ) {
        val token = auth.ensureAccessToken() ?: throw ServerApiException(0, "not_logged_in", "server 未登录")
        val body = buildJsonObject {
            put("conversationId", conversationId)
            put("runSeq", runSeq)
            put("requestId", requestId)
            put("calls", json.encodeToJsonElement(ListSerializer(ToolCall.serializer()), calls))
            put("leaseToken", leaseToken ?: "")
        }
        http.request("POST", "/v1/approvals", token, body, expect = intArrayOf(201))
    }

    /** 待决列表（server 惰性过期 pending）。 */
    suspend fun pending(conversationId: String): List<ApprovalRecord> {
        val token = auth.ensureAccessToken() ?: throw ServerApiException(0, "not_logged_in", "server 未登录")
        val body = http.request("GET", "/v1/approvals?conversationId=$conversationId", token)
            ?: return emptyList()
        return json.decodeFromJsonElement(
            ListSerializer(ApprovalRecord.serializer()),
            body["approvals"] ?: return emptyList(),
        )
    }

    /**
     * 本机决策上行：**失败静默**（网络断/409 already_decided 均忽略——
     * server 懒过期兜底，另一端的 SSE 决议或超时会收敛状态）。
     */
    suspend fun resolve(requestId: String, decision: ApprovalDecision, comment: String? = null) {
        try {
            val token = auth.ensureAccessToken() ?: return
            http.request(
                "POST",
                "/v1/approvals/$requestId/resolve",
                token,
                buildJsonObject {
                    put("decision", decision.label)
                    comment?.let { put("comment", it) }
                },
            )
        } catch (_: Exception) {
            // 静默：server 懒过期 + 他端 SSE 决议兜底
        }
    }

    /**
     * SSE approval_resolved → 本地 gate 回填（先到者生效；本地已决/超时则 complete 返回 false 自然忽略）。
     */
    fun onSseResolved(event: ServerEvent.ApprovalResolved, gate: ApprovalGate) {
        val decision = if (event.decision == "approve") ApprovalDecision.Approve
        else ApprovalDecision.Reject(event.comment)
        gate.resolve(event.requestId, decision)
    }

    /**
     * 装配审批门：onRequest 回调先发本地 UI，再上报 server（上报失败不阻塞——
     * 单端审批仍可用，server 侧只是收不到广播）。
     */
    fun gate(
        timeoutMs: Long = 120_000,
        conversationId: () -> String,
        runSeqProvider: (ApprovalRequest) -> Int = { it.runSeq },
        leaseToken: () -> String?,
        onRequestLocal: suspend (ApprovalRequest) -> Unit = {},
    ): ApprovalGate = ApprovalGate(timeoutMs = timeoutMs) { request ->
        onRequestLocal(request)
        runCatching {
            report(conversationId(), runSeqProvider(request), request.requestId, request.calls, leaseToken())
        }
    }
}
