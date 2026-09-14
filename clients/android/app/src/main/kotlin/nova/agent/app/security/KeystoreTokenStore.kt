package nova.agent.app.security

import android.content.Context
import android.util.Log
import androidx.datastore.preferences.core.byteArrayPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import nova.agent.net.auth.AuthTokens
import nova.agent.net.auth.FileTokenStore
import nova.agent.net.auth.TokenStore

private val Context.authDataStore by preferencesDataStore(name = "nova_auth")

/** 密文 blob 的持久化端口（测试用内存实现，生产 = DataStore Preferences）。 */
interface TokenBlobStore {
    /** null = 清除。 */
    fun save(blob: ByteArray?)

    fun load(): ByteArray?
}

class DataStoreBlobStore(private val context: Context) : TokenBlobStore {
    override fun save(blob: ByteArray?) {
        runBlocking {
            context.authDataStore.edit { prefs ->
                if (blob == null) prefs.remove(KEY) else prefs[KEY] = blob
            }
        }
    }

    override fun load(): ByteArray? = runBlocking { context.authDataStore.data.first()[KEY] }

    private companion object {
        val KEY = byteArrayPreferencesKey("auth_blob")
    }
}

/**
 * :app 的 TokenStore 实现（PRD FR1）：AndroidKeyStore 加密（AES-256-GCM）后存 DataStore。
 * 安全红线对齐 :core:net 的 KDoc——令牌永不明文进普通配置。
 *
 * KeyStore 不可用（极端机型）时回落 [FileTokenStore] 明文路径并打点，
 * 该路径不应出现在 release（构造方决定 fallback 是否传入）。
 * [TokenStore] 接口是同步的：DataStore 读写经 runBlocking（单键极小 IO）。
 */
class KeystoreTokenStore(
    private val cipher: TokenCipher?,
    private val blobs: TokenBlobStore,
    private val fallback: TokenStore? = null,
) : TokenStore {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    override fun save(tokens: AuthTokens) {
        val c = cipher ?: run {
            nova.agent.app.di.D { "TokenStore save via PLAINTEXT fallback (keystore unavailable)" }
            fallback?.save(tokens)
            return
        }
        runCatching { blobs.save(c.encrypt(json.encodeToString(AuthTokens.serializer(), tokens).toByteArray())) }
            .onFailure { nova.agent.app.di.D { "TokenStore save FAILED: ${it::class.simpleName} ${it.message}" } }
        nova.agent.app.di.D { "TokenStore save ok len=${blobs.load()?.size}" }
    }

    override fun load(): AuthTokens? {
        if (cipher == null) {
            nova.agent.app.di.D { "TokenStore load via PLAINTEXT fallback" }
            return fallback?.load()
        }
        val blob = blobs.load()
        if (blob == null) {
            nova.agent.app.di.D { "TokenStore load: no blob" }
            return null
        }
        return try {
            val t = json.decodeFromString(AuthTokens.serializer(), String(cipher.decrypt(blob)))
            nova.agent.app.di.D { "TokenStore load ok user=${t.username}" }
            t
        } catch (e: Exception) {
            // 损坏（密钥轮换/写一半崩溃）按未配置处理并自清理
            nova.agent.app.di.D { "TokenStore load CORRUPT (${e::class.simpleName}: ${e.message}) -> clear" }
            clear()
            null
        }
    }

    override fun clear() {
        blobs.save(null)
        fallback?.clear()
    }

    companion object {
        private const val TAG = "KeystoreTokenStore"
        const val AUTH_ALIAS = "nova.auth.tokens"
        const val BYOK_ALIAS = "nova.byok.key"

        fun fromContext(context: Context): KeystoreTokenStore {
            val cipher = try {
                KeystoreTokenCipher(AUTH_ALIAS)
            } catch (t: Throwable) {
                Log.w(TAG, "AndroidKeyStore 不可用，令牌回落明文 FileTokenStore（release 不应出现）", t)
                null
            }
            val fallback = if (cipher == null) {
                FileTokenStore(context.filesDir.resolve("tokens-plain.json").toPath())
            } else {
                null
            }
            return KeystoreTokenStore(cipher, DataStoreBlobStore(context), fallback)
        }
    }
}
