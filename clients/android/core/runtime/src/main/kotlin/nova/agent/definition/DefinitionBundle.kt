package nova.agent.definition

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * 定义包（docs/PRD/定义包-agent策略统一.md）——Agent 完整策略面的可序列化载体。
 * 与 core TS 侧 `runtime/definition/bundle.ts` 同一 JSON 契约；
 * golden 夹具 core/src/runtime/definition/fixtures/definition-novel-1.5.0.json 双端共用（对拍种子）。
 *
 * 数据化分层：纯数据全量进包（static 段文案/工具组清单/compact 参数）；
 * 代码引用只留 id（rendererId/trigger/policyId），端能力声明必须覆盖——
 * 能力协商见 server `POST /v1/definitions/resolve`。
 */
@Serializable
data class DefinitionBundle(
    val bundleSchemaVersion: Int,
    val definitionVersion: String,
    val agentType: String,
    val label: String = "",
    val prompt: PromptSpec,
    val tools: ToolsSpec = ToolsSpec(),
    val nudges: List<NudgeRef> = emptyList(),
    val compact: CompactSpec,
    val delegation: DelegationSpec? = null,
    val communication: CommunicationSpec? = null,
    val runtimePolicyId: String = "default",
)

@Serializable
data class PromptSpec(val recipe: List<RecipeItem>)

@Serializable
sealed interface RecipeItem {
    @Serializable
    @SerialName("static")
    data class Static(
        val sectionId: String,
        val version: String,
        val content: String,
    ) : RecipeItem

    @Serializable
    @SerialName("dynamic")
    data class Dynamic(
        val sectionId: String,
        val version: String,
        val rendererId: String,
        val params: JsonObject? = null,
    ) : RecipeItem
}

@Serializable
data class ToolsSpec(
    val groups: List<ToolGroupRef> = emptyList(),
    val allow: List<String>? = null,
    val deny: List<String>? = null,
    /** 工具策略覆盖（schema 本体不进包——与 handler 同版本演进，端装配时校验）。 */
    val overrides: Map<String, ToolOverride> = emptyMap(),
)

@Serializable
data class ToolGroupRef(
    val groupId: String,
    val version: String,
    val label: String = "",
    val tools: List<String> = emptyList(),
)

@Serializable
data class ToolOverride(
    val requireApproval: Boolean? = null,
    val policy: String? = null,
    val guidance: String? = null,
)

@Serializable
data class NudgeRef(
    val nudgeId: String,
    /** persistent（落 journal）/ transient（原地改请求）/ both。 */
    val trigger: String = "persistent",
    val rateLimit: JsonObject? = null,
)

@Serializable
data class CompactSpec(
    val chain: List<CompactPolicySpec>,
    val fuse: FuseSpec = FuseSpec(),
)

@Serializable
data class CompactPolicySpec(
    val policyId: String,
    val params: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class FuseSpec(val retryOnce: Boolean = true)

@Serializable
data class DelegationSpec(
    val mode: String = "disabled",
    val allowedAgentTypes: List<String> = emptyList(),
)

@Serializable
data class CommunicationSpec(val role: String = "standalone")

/** 解析器：classDiscriminator 对齐 TS 侧的 "kind" 判别键；容忍未知字段（包向前演进）。 */
object DefinitionBundleCodec {
    val json: Json = Json {
        ignoreUnknownKeys = true
        classDiscriminator = "kind"
        encodeDefaults = true
    }

    fun decode(text: String): DefinitionBundle = json.decodeFromString(DefinitionBundle.serializer(), text)

    fun encode(bundle: DefinitionBundle): String = json.encodeToString(DefinitionBundle.serializer(), bundle)
}
