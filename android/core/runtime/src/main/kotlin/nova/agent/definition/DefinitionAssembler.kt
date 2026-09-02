package nova.agent.definition


import kotlinx.serialization.json.jsonPrimitive
import nova.agent.compact.CompactionConfig
import nova.agent.tool.ToolDef

/**
 * 定义包装配器：把「内容与参数」装配为运行时对象，并做能力校验。
 *
 * 端职责边界：static 段直接拼接；dynamic 段由端上渲染器注册表渲染（本类只透传 rendererId）；
 * compact 链按 policyId 实例化为 [CompactionConfig] 参数；工具策略过滤 + 审批覆盖。
 */
class DefinitionAssembler(val bundle: DefinitionBundle) {

    /** 端能力声明：本端支持的 rendererId / compact policyId / nudgeId / 工具组 id。 */
    data class Capabilities(
        val renderers: Set<String> = emptySet(),
        val policies: Set<String> = emptySet(),
        val triggers: Set<String> = emptySet(),
        val toolGroups: Set<String> = emptySet(),
    )

    fun requirements(): Capabilities = Capabilities(
        renderers = bundle.prompt.recipe.filterIsInstance<RecipeItem.Dynamic>().map { it.rendererId }.toSet(),
        policies = bundle.compact.chain.map { it.policyId }.toSet(),
        triggers = bundle.nudges.map { it.nudgeId }.toSet(),
        toolGroups = bundle.tools.groups.map { it.groupId }.toSet(),
    )

    /** 能力校验：返回缺失项清单（空 = 可装配）。整包拒绝语义——缺任何一项都不得装配（回退缓存旧包）。 */
    fun validateCapabilities(caps: Capabilities): List<String> {
        val req = requirements()
        val missing = mutableListOf<String>()
        missing += req.renderers.filterNot { it in caps.renderers }.map { "renderer:$it" }
        missing += req.policies.filterNot { it in caps.policies }.map { "policy:$it" }
        missing += req.triggers.filterNot { it in caps.triggers }.map { "nudge:$it" }
        missing += req.toolGroups.filterNot { it in caps.toolGroups }.map { "toolGroup:$it" }
        return missing
    }

    /**
     * 组装 system prompt：static 段按 recipe 序拼接（空行分隔）；
     * dynamic 段经 [dynamicRenderer] 渲染（渲染器可能读文件/查库，故为 suspend；返回 null/空 = 整段省略）。
     */
    suspend fun assembleSystemPrompt(
        dynamicRenderer: (suspend (RecipeItem.Dynamic) -> String?)? = null,
    ): String {
        val parts = mutableListOf<String>()
        for (item in bundle.prompt.recipe) {
            when (item) {
                is RecipeItem.Static -> if (item.content.isNotEmpty()) parts.add(item.content)
                is RecipeItem.Dynamic -> {
                    val rendered = dynamicRenderer?.invoke(item)
                    if (!rendered.isNullOrEmpty()) parts.add(rendered)
                }
            }
        }
        return parts.joinToString("\n\n")
    }

    /** compact 链参数 → Android 侧 [CompactionConfig]（字段语义与桌面 AutoCompactOptions 一一映射）。 */
    fun toCompactionConfig(
        contextWindowTokens: Int = 64_000,
        charsPerToken: Double = 2.0,
    ): CompactionConfig {
        val byId = bundle.compact.chain.associateBy { it.policyId }
        val t1 = byId["t1-skeletonize"]?.params
        val t2 = byId["t2-summarize"]?.params
        val t3 = byId["t3-drop-oldest"]?.params
        return CompactionConfig(
            contextWindowTokens = contextWindowTokens,
            charsPerToken = charsPerToken,
            t1ThresholdRatio = t1?.get("t1Ratio")?.asDouble() ?: 0.70,
            t2ReserveTokens = t2?.get("t2MarginTokens")?.asInt() ?: 12_000,
            t3ThresholdRatio = t3?.get("t3Ratio")?.asDouble() ?: (t2?.get("t2CapRatio")?.asDouble() ?: 0.92),
            maxOutputTokens = t2?.get("summaryMaxTokens")?.asInt() ?: 2_048,
            keepFirstRuns = t1?.get("keepFirst")?.asInt() ?: 1,
            keepLastRuns = t1?.get("keepLast")?.asInt() ?: 3,
        )
    }

    /**
     * 工具策略装配：按包的组清单过滤（组内工具名序），叠加 allow/deny 与
     * overrides（requireApproval 覆盖——策略面数据化的落点，改包即变审批面）。
     */
    fun applyToolPolicy(allTools: List<ToolDef>): List<ToolDef> {
        val allowedNames = bundle.tools.groups.flatMap { it.tools }.toMutableSet()
        bundle.tools.allow?.let { allow ->
            allowedNames.retainAll(allow)
        }
        bundle.tools.deny?.forEach { allowedNames.remove(it) }
        val byName = allTools.associateBy { it.name }
        return allowedNames.mapNotNull { name ->
            byName[name]?.let { def ->
                val override = bundle.tools.overrides[name]
                if (override?.requireApproval != null && override.requireApproval != def.requireApproval) {
                    def.copy(requireApproval = override.requireApproval)
                } else {
                    def
                }
            }
        }
    }

    private fun kotlinx.serialization.json.JsonElement?.asInt(): Int? =
        runCatching { this?.jsonPrimitive?.content?.toInt() }.getOrNull()

    private fun kotlinx.serialization.json.JsonElement?.asDouble(): Double? =
        runCatching { this?.jsonPrimitive?.content?.toDouble() }.getOrNull()
}

private fun ToolDef.copy(requireApproval: Boolean): ToolDef = ToolDef(
    name = name,
    description = description,
    parameters = parameters,
    version = version,
    requireApproval = requireApproval,
    precheck = precheck,
    handler = handler,
)
