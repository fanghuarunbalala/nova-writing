package nova.agent.net.lease

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.NetworkUnreachableException
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp
import nova.agent.net.http.await
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class LeaseGrant(val leaseToken: String, val expiresAt: Long, val renewed: Boolean = false)

/** 409 lease_held：他端持有（会话转只读 + 提示持有者）。 */
class LeaseHeldException(val holderDeviceId: String, val expiresAt: Long) :
    ServerApiException(409, "lease_held", "会话正被其他设备执行", JsonObject(emptyMap()))

/** 410/403：租约失效/被回收（含 device_revoked）——中止 run 走 settlePendingRun 恢复语义。 */
class LeaseLostException(val reason: String, message: String) :
    ServerApiException(410, reason, message)

/**
 * 会话租约仲裁客户端（桌面端 LeaseClient 对应物）：一个会话同一时刻只有一个执行端。
 * 心跳 20s < TTL 60s；被踢设备 session 失效 → 心跳 410 → 租约自动回收。
 */
class LeaseClient(
    private val http: ServerHttp,
    private val auth: ServerAuthSession,
    private val heartbeatIntervalMs: Long = 20_000,
) {

    /** 同设备重复 acquire = 续租（server 语义，token 不变）。 */
    suspend fun acquire(conversationId: String): LeaseGrant {
        val token = auth.ensureAccessToken() ?: throw LeaseLostException("not_logged_in", "server 未登录")
        val body = buildJsonObject { put("conversationId", conversationId) }
        return try {
            val resp = http.request("POST", "/v1/leases", token, body)
                ?: throw ServerApiException(200, "bad_response", "租约响应为空")
            LeaseGrant(
                leaseToken = resp["leaseToken"]!!.jsonPrimitive.content,
                expiresAt = resp["expiresAt"]!!.jsonPrimitive.long,
                renewed = resp["renewed"]?.jsonPrimitive?.content == "true",
            )
        } catch (e: ServerApiException) {
            throw when {
                e.status == 409 -> LeaseHeldException(
                    holderDeviceId = (e.extras["holderDeviceId"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "?",
                    expiresAt = (e.extras["expiresAt"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: 0,
                )
                e.status == 410 || e.status == 403 -> LeaseLostException(e.code, e.message ?: "租约失效")
                else -> e
            }
        }
        // NetworkUnreachableException 原样上抛：调用方容忍重试（TTL 内恢复不丢）
    }

    /** 单次心跳：410/403 → LeaseLostException；网络错 → NetworkUnreachableException（容忍）。 */
    suspend fun heartbeat(conversationId: String, leaseToken: String): Long {
        val token = auth.ensureAccessToken() ?: throw LeaseLostException("not_logged_in", "server 未登录")
        val resp = try {
            http.request("POST", "/v1/leases/$conversationId/heartbeat", token, buildJsonObject { put("leaseToken", leaseToken) })
        } catch (e: ServerApiException) {
            if (e.status == 410 || e.status == 403) throw LeaseLostException(e.code, e.message ?: "租约失效")
            throw e
        }
        return resp?.get("expiresAt")?.jsonPrimitive?.long ?: 0
    }

    /**
     * 心跳循环（守护协程，20s 周期）：LeaseLost → onLost 回调后退出；网络类错误吞掉
     * （60s TTL 内恢复不丢租约）。leaseToken 每轮现取（acquire 续租后 token 可能更新）。
     */
    fun startHeartbeat(
        scope: CoroutineScope,
        conversationId: String,
        leaseToken: () -> String?,
        onLost: (LeaseLostException) -> Unit = {},
    ): Job = scope.launch {
        while (isActive) {
            delay(heartbeatIntervalMs)
            val token = leaseToken() ?: continue
            try {
                heartbeat(conversationId, token)
            } catch (e: LeaseLostException) {
                onLost(e)
                break
            } catch (_: Exception) {
                // 网络容忍：TTL 内恢复即可
            }
        }
    }

    /** 释放：DELETE 带 JSON body；所有错误静默（孤儿租约靠 60s TTL 回收）。幂等。 */
    suspend fun release(conversationId: String, leaseToken: String) {
        try {
            val token = auth.ensureAccessToken() ?: return
            val body = buildJsonObject { put("leaseToken", leaseToken) }
                .toString().toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url(http.baseUrl + "/v1/leases/$conversationId")
                .method("DELETE", body)
                .header("Authorization", "Bearer $token")
                .build()
            http.client.newCall(request).await().close()
        } catch (_: Exception) {
            // 静默
        }
    }
}
