package nova.agent.app.security

import nova.agent.net.auth.AuthTokens
import nova.agent.net.auth.FileTokenStore
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 注入假加解密器覆盖编解码/损坏回退/清空（PRD FR12；不触碰真 KeyStore）。 */
class KeystoreTokenStoreTest {

    /** XOR 混淆假加密：可逆且密文不含明文子串。 */
    private class FakeCipher : TokenCipher {
        override fun encrypt(plain: ByteArray): ByteArray = ByteArray(plain.size) { (plain[it].toInt() xor 0x5A).toByte() }
        override fun decrypt(blob: ByteArray): ByteArray = ByteArray(blob.size) { (blob[it].toInt() xor 0x5A).toByte() }
    }

    private class MemBlobs : TokenBlobStore {
        var blob: ByteArray? = null
        override fun save(blob: ByteArray?) {
            this.blob = blob
        }
        override fun load(): ByteArray? = blob
    }

    private val tokens = AuthTokens(accessToken = "at-1", refreshToken = "rt-1", username = "alice", accessExpiresAt = 1_000L)

    @Test
    fun roundTripPreservesTokens() {
        val blobs = MemBlobs()
        val store = KeystoreTokenStore(FakeCipher(), blobs)
        store.save(tokens)
        assertEquals(tokens, store.load())
        assertTrue(blobs.blob != null && !String(blobs.blob!!, Charsets.ISO_8859_1).contains("rt-1"), "密文不应含明文令牌")
    }

    @Test
    fun corruptBlobClearsAndReturnsNull() {
        val blobs = MemBlobs()
        val store = KeystoreTokenStore(FakeCipher(), blobs)
        store.save(tokens)
        blobs.blob = byteArrayOf(1, 2, 3)
        assertNull(store.load())
        assertNull(blobs.blob, "损坏后应自清理")
        store.save(tokens)
        assertEquals(tokens, store.load(), "自清理后应可重新写入")
    }

    @Test
    fun nullCipherFallsBackToPlaintextStore() {
        val dir = Files.createTempDirectory("nova-fallback")
        val fallback = FileTokenStore(dir.resolve("tokens.json"))
        val store = KeystoreTokenStore(null, MemBlobs(), fallback)
        store.save(tokens)
        assertEquals(tokens, store.load())
    }

    @Test
    fun clearWipesBlob() {
        val blobs = MemBlobs()
        val store = KeystoreTokenStore(FakeCipher(), blobs)
        store.save(tokens)
        store.clear()
        assertNull(store.load())
        assertNull(blobs.blob)
    }
}
