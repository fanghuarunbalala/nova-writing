package nova.agent.net.auth

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp

/** register/login/refresh 的共同响应（server 不回传 username——refresh 后由会话层保留旧值）。 */
@Serializable
data class AuthGrant(
    val accessToken: String,
    val refreshToken: String,
    val userId: String = "",
    val deviceId: String = "",
)

/**
 * 认证 REST 封装（桌面端 ServerAuthClient 对应物，无状态）。
 * 错误统一抛 ServerApiException（400 invalid_username/weak_password、401 invalid_credentials、
 * 409 username_taken、401 token_reuse_detected/revoked/expired 等，code 原样上抛给 UI）。
 */
class ServerAuthClient(
    baseUrl: String,
    client: okhttp3.OkHttpClient = ServerHttp.defaultClient(),
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    private val http = ServerHttp(baseUrl.trimEnd('/'), client, json)

    /** 注册即登录：201 回双令牌。 */
    suspend fun register(username: String, password: String, deviceName: String): AuthGrant =
        grant(http.request("POST", "/v1/auth/register", body = body(username, password, deviceName), expect = intArrayOf(201)))

    suspend fun login(username: String, password: String, deviceName: String): AuthGrant =
        grant(http.request("POST", "/v1/auth/login", body = body(username, password, deviceName)))

    /** 一次一换；401 = 复用检测/过期/吊销（调用方清令牌转 NeedRelogin）。 */
    suspend fun refresh(refreshToken: String): AuthGrant =
        grant(
            http.request(
                "POST",
                "/v1/auth/refresh",
                body = buildJsonObject { put("refreshToken", refreshToken) },
            )
        )

    suspend fun logout(refreshToken: String) {
        http.request(
            "POST",
            "/v1/auth/logout",
            body = buildJsonObject { put("refreshToken", refreshToken) },
            expect = intArrayOf(204),
        )
    }

    suspend fun devices(accessToken: String): List<DeviceInfo> {
        val body = http.request("GET", "/v1/auth/devices", accessToken)
            ?: throw ServerApiException(200, "bad_response", "devices 响应为空")
        return json.decodeFromJsonElement(
            ListSerializer(DeviceInfo.serializer()),
            (body["devices"] ?: throw ServerApiException(200, "bad_response", "响应缺少 devices")).jsonArray,
        )
    }

    suspend fun kickDevice(accessToken: String, deviceId: String) {
        http.request("DELETE", "/v1/auth/devices/$deviceId", accessToken, expect = intArrayOf(204))
    }

    private fun body(username: String, password: String, deviceName: String): JsonObject = buildJsonObject {
        put("username", username)
        put("password", password)
        put("deviceName", deviceName)
    }

    private fun grant(body: JsonObject?): AuthGrant {
        body ?: throw ServerApiException(200, "bad_response", "认证响应为空")
        fun str(key: String): String = (body[key] as? kotlinx.serialization.json.JsonPrimitive)
            ?.takeIf { it.isString && it.content.isNotEmpty() }?.content
            ?: throw ServerApiException(200, "bad_response", "响应缺少字段 $key")
        return AuthGrant(
            accessToken = str("accessToken"),
            refreshToken = str("refreshToken"),
            userId = (body["userId"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "",
            deviceId = (body["deviceId"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "",
        )
    }
}
