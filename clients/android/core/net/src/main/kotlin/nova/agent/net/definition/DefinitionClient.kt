package nova.agent.net.definition

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nova.agent.definition.DefinitionBundle
import nova.agent.definition.DefinitionBundleCodec
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp
import java.nio.file.Files
import java.nio.file.Path

/**
 * 定义包拉取与缓存（PRD FR9）：resolve 能力协商 → 缓存 `definitions/<version>.json` →
 * DefinitionAssembler 装配（在 :core:runtime，AgentSession 构造时完成）。
 * 404 no_compatible_definition（端能力落后）→ 回退本地缓存最新旧版——能力协商的降级路径。
 */
class DefinitionClient(
    private val http: ServerHttp,
    private val auth: ServerAuthSession,
    private val cacheDir: Path,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {

    /**
     * 能力协商：返回该端【能装配的最新包】。
     * 无兼容包 → 回退缓存最新旧版；缓存也没有 → 抛 ServerApiException（404 原样）。
     */
    suspend fun resolve(
        agentType: String = "novel",
        capabilities: JsonObject,
    ): DefinitionBundle {
        val token = auth.ensureAccessToken() ?: throw ServerApiException(0, "not_logged_in", "server 未登录")
        val body = buildJsonObject {
            put("agentType", agentType)
            put("capabilities", capabilities)
        }
        val bundle = try {
            val resp = http.request("POST", "/v1/definitions/resolve", token, body)
                ?: throw ServerApiException(200, "bad_response", "resolve 响应为空")
            val bundleEl = resp["bundle"]
                ?: throw ServerApiException(200, "bad_response", "响应缺少 bundle")
            DefinitionBundleCodec.json.decodeFromJsonElement(DefinitionBundle.serializer(), bundleEl)
        } catch (e: ServerApiException) {
            if (e.status == 404) {
                cachedLatest() ?: throw e // 无缓存可回退 → 原样上抛（提示升级 App）
            } else throw e
        }
        persist(bundle)
        return bundle
    }

    /** 缓存最新旧版（semver 降序取第一个可解析的）；无缓存返回 null。 */
    fun cachedLatest(): DefinitionBundle? {
        val dir = cacheDir.resolve("definitions")
        val files = runCatching { Files.list(dir).use { it.filter { p -> p.fileName.toString().endsWith(".json") }.toList() } }
            .getOrDefault(emptyList())
        return files
            .sortedWith { a, b ->
                val ka = a.fileName.toString().removeSuffix(".json").semverKey()
                val kb = b.fileName.toString().removeSuffix(".json").semverKey()
                compareValuesBy(ka, kb, { it.getOrElse(0) { 0 } }, { it.getOrElse(1) { 0 } }, { it.getOrElse(2) { 0 } })
            }
            .reversed()
            .firstNotNullOfOrNull { p ->
                runCatching { DefinitionBundleCodec.decode(String(Files.readAllBytes(p))) }.getOrNull()
            }
    }

    private fun persist(bundle: DefinitionBundle) {
        runCatching {
            val dir = cacheDir.resolve("definitions")
            Files.createDirectories(dir)
            Files.write(dir.resolve("${bundle.definitionVersion}.json"), DefinitionBundleCodec.encode(bundle).toByteArray())
        }
    }

    private fun String.semverKey(): List<Int> = split(".").map { it.toIntOrNull() ?: 0 }
}
