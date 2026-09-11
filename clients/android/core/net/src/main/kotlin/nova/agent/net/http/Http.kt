package nova.agent.net.http

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * server API 统一错误：错误体 {code, message, ...extras} 的异常化（契约 §1）。
 * extras 保留完整错误体——乐观冲突附带的当前值（currentLastSeq/currentVersion/holderDeviceId 等）从这里取。
 */
open class ServerApiException(
    val status: Int,
    val code: String,
    message: String,
    val extras: JsonObject = JsonObject(emptyMap()),
) : Exception(message)

/** 网络不可达（连接失败/超时/SSE 断流）——与 HTTP 状态错误严格区分：调用方按离线处理（入积压队/容忍重试）。 */
class NetworkUnreachableException(cause: Throwable) : Exception("无法连接服务器：${cause.message}", cause)

/** OkHttp 阻塞调用的协程桥：enqueue + 取消传播（协程取消 → call.cancel() 掐断连接，不悬挂请求）。 */
suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) {
            cont.resume(response)
        }

        override fun onFailure(call: Call, e: IOException) {
            if (cont.isCancelled) cont.cancel(e) else cont.resumeWithException(NetworkUnreachableException(e))
        }
    })
    cont.invokeOnCancellation { cancel() }
}

/**
 * REST 基座：所有 :core:net 客户端共用（桌面端 requestJson 的对应物）。
 * - 204/空体 → null；其余解析为 JsonObject；
 * - 非 expect 状态 → ServerApiException（错误体尽力取 code/message，extras 带全量）；
 * - 网络失败 → NetworkUnreachableException。
 */
class ServerHttp(
    val baseUrl: String,
    val client: OkHttpClient = defaultClient(),
    val json: Json = Json { ignoreUnknownKeys = true },
) {

    suspend fun request(
        method: String,
        path: String,
        accessToken: String? = null,
        body: JsonObject? = null,
        expect: IntArray = intArrayOf(200),
    ): JsonObject? {
        val requestBody = body?.toString()?.toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url(baseUrl + path)
            .method(method, requestBody)
            .apply { accessToken?.let { header("Authorization", "Bearer $it") } }
            .build()
        client.newCall(request).await().use { response ->
            if (!expect.contains(response.code)) throw parseError(response)
            val text = try { response.body?.string().orEmpty() } catch (_: IOException) { "" }
            if (text.isEmpty()) return null
            return json.parseToJsonElement(text).jsonObject
        }
    }

    private fun parseError(response: Response): ServerApiException {
        val text = try { response.body?.string().orEmpty() } catch (_: Exception) { "" }
        val obj = try { json.parseToJsonElement(text).jsonObject } catch (_: Exception) { null }
        val code = obj.str("code") ?: "http_${response.code}"
        val message = obj.str("message") ?: "服务器返回 ${response.code}"
        return ServerApiException(response.code, code, message, obj ?: JsonObject(emptyMap()))
    }

    private fun JsonObject?.str(key: String): String? =
        (this?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content

    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()

        /** SSE 专用：长连接不设读超时（server 每 15s 心跳注释行兼当活性信号）。 */
        fun sseClient(): OkHttpClient = defaultClient().newBuilder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }
}
