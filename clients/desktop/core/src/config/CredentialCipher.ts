/**
 * CredentialCipher：凭据加密抽象。
 * node 实现用 Electron safeStorage；测试用明文/内存。
 */

/** 凭据加密器（encrypt 落盘前 / decrypt 读取后） */
export interface CredentialCipher {
	/**
	 * 加密明文密钥
	 * @param secret 明文密钥
	 * @returns 密文
	 */
	encrypt(secret: string): Promise<string>
	/**
	 * 解密密文密钥
	 * @param ciphertext 密文
	 * @returns 明文
	 */
	decrypt(ciphertext: string): Promise<string>
}
