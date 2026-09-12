package nova.agent.net.auth

import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * 双令牌持久化抽象。安全红线：令牌永不明文进普通配置。
 * :app 阶段必须提供 Android Keystore 加密实现（EncryptedSharedPreferences 后继或 DataStore+Tink）。
 */
interface TokenStore {
    fun save(tokens: AuthTokens)
    fun load(): AuthTokens?
    fun clear()
}

/**
 * JVM 明文 JSON 文件实现——仅测试/桌面调试用。
 * KDoc 红线即约束：:app 接入时换 Keystore 实现，本实现不打包进 release。
 */
class FileTokenStore(private val path: Path) : TokenStore {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    override fun save(tokens: AuthTokens) {
        Files.createDirectories(path.toAbsolutePath().parent)
        val tmp = path.resolveSibling(path.fileName.toString() + ".tmp")
        Files.write(tmp, json.encodeToString(AuthTokens.serializer(), tokens).toByteArray())
        Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }

    override fun load(): AuthTokens? = try {
        if (!Files.exists(path)) null
        else json.decodeFromString(AuthTokens.serializer(), String(Files.readAllBytes(path)))
    } catch (_: Exception) {
        null // 损坏按未配置处理
    }

    override fun clear() {
        // 对齐桌面：写入空文件（保留文件占位，不删除）
        runCatching {
            Files.createDirectories(path.toAbsolutePath().parent)
            Files.write(path, ByteArray(0))
        }
    }
}
