package nova.agent.net.auth

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 双令牌（契约 §1 / 认证 PRD）：access JWT 15min 无状态 + refresh 60 天一次一换。
 * accessExpiresAt 为客户端本地换算（now + ACCESS_TTL_MS，桌面端同款——不解析 JWT）。
 */
@Serializable
data class AuthTokens(
    val accessToken: String,
    val refreshToken: String,
    val username: String,
    val userId: String = "",
    val deviceId: String = "",
    val accessExpiresAt: Long,
)

/** server GET /v1/auth/devices 行（snake_case 原样）。 */
@Serializable
data class DeviceInfo(
    val id: String,
    val name: String,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("last_seen_at") val lastSeenAt: Long = 0,
    @SerialName("active_sessions") val activeSessions: Int = 0,
)

/**
 * 认证会话四态（桌面端「unconfigured/online/offline + needRelogin 布尔」的 sealed 呈现）。
 * 纯云端化：Unconfigured/NeedRelogin 都落登录门；Offline 保留离线只读缓存可用。
 */
sealed interface AuthState {
    data object Unconfigured : AuthState
    data class Online(val username: String, val deviceId: String) : AuthState
    data object Offline : AuthState
    data object NeedRelogin : AuthState
}
