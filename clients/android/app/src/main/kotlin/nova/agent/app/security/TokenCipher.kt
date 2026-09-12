package nova.agent.app.security

/**
 * 令牌类敏感值的加解密端口（M4 阶段3 FR1/FR9）。
 * Android 实现 = AndroidKeyStore AES-256-GCM（[KeystoreTokenCipher]）；
 * JVM 单测注入假实现覆盖编解码与损坏回退，不触碰 KeyStore。
 */
interface TokenCipher {
    /** 返回 iv + ciphertext（自包含 blob，存储侧无需再记 iv）。 */
    fun encrypt(plain: ByteArray): ByteArray

    fun decrypt(blob: ByteArray): ByteArray
}

/**
 * AndroidKeyStore AES-256-GCM 加解密器：密钥不出安全硬件别名（[alias]），
 * blob 布局 = 12 字节 IV + 密文。构造即取回既有密钥、无则生成，KeyStore 异常向上抛
 * （调用方 [KeystoreTokenStore.fromContext] 捕获后回落明文路径并打点）。
 *
 * 注意：AndroidKeyStore 的 KeyGenerator.generateKey() 会无条件覆盖同名别名，
 * 必须「先取回、缺失才生成」，否则每次进程重启密钥轮换、旧密文全部 AEADBadTag。
 */
class KeystoreTokenCipher(alias: String) : TokenCipher {

    private val key: javax.crypto.SecretKey = loadOrCreate(alias)

    private fun loadOrCreate(alias: String): javax.crypto.SecretKey {
        val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? javax.crypto.SecretKey)?.let {
            nova.agent.app.di.D { "Cipher key REUSED alias=$alias" }
            return it
        }
        nova.agent.app.di.D { "Cipher key GENERATED alias=$alias" }
        return javax.crypto.KeyGenerator
            .getInstance("AES", "AndroidKeyStore")
            .apply {
                init(
                    android.security.keystore.KeyGenParameterSpec.Builder(
                        alias,
                        android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                            android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
                    )
                        .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build()
                )
            }
            .generateKey()
    }

    override fun encrypt(plain: ByteArray): ByteArray {
        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, key)
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun decrypt(blob: ByteArray): ByteArray {
        require(blob.size > IV_LEN) { "密文 blob 过短: ${blob.size}" }
        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            javax.crypto.Cipher.DECRYPT_MODE,
            key,
            javax.crypto.spec.GCMParameterSpec(TAG_BITS, blob.copyOfRange(0, IV_LEN)),
        )
        return cipher.doFinal(blob.copyOfRange(IV_LEN, blob.size))
    }

    private companion object {
        const val IV_LEN = 12
        const val TAG_BITS = 128
    }
}
