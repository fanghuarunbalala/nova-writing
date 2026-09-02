package nova.agent.definition

/**
 * dynamic 段渲染器（定义包-端侧迁移 PRD FR6 首批三段）——
 * 与桌面端 core/src/runtime/prompt/sections/agent.ts 逐字节对齐，对拍夹具 parity-sections.json。
 */
object DynamicRenderers {

    /** 工具视图：tool.policy / tool.guidance 只消费这两个字段。 */
    data class ToolView(val name: String, val policy: String? = null, val guidance: String? = null)

    data class Environment(
        val workdir: String,
        val platform: String,
        val modelId: String? = null,
        /** 注入日期 YYYY-MM-DD（确定性测试）；缺省现场计算。 */
        val date: String? = null,
        val timezone: String? = null,
    )

    private fun localDate(): String {
        val now = java.time.LocalDate.now()
        return "%04d-%02d-%02d".format(now.year, now.monthValue, now.dayOfMonth)
    }

    private fun timezone(): String =
        try {
            java.time.ZoneId.systemDefault().id.ifEmpty { "UTC" }
        } catch (_: Exception) {
            "UTC"
        }

    /** tool.policy：`# Using Tools` + 名单行（逗号+空格连接、行尾分号）+ 非空 policy 各一行。 */
    fun toolPolicy(tools: List<ToolView>): String {
        if (tools.isEmpty()) {
            return "No Tools are available in this Agent Manifest. Do not simulate Tool execution."
        }
        val lines = mutableListOf(
            "# Using Tools",
            "- available tools: ${tools.joinToString(", ") { it.name }};",
        )
        for (tool in tools) {
            val policy = tool.policy?.trim()
            if (!policy.isNullOrEmpty()) lines.add(policy)
        }
        return lines.joinToString("\n")
    }

    /** tool.guidance：非空 guidance 块以空行分隔；全空返回空串（整段省略）。 */
    fun toolGuidance(tools: List<ToolView>): String =
        tools.mapNotNull { it.guidance?.trim()?.takeIf { b -> b.isNotEmpty() } }.joinToString("\n\n")

    /** core.environment：四或五行；workdir/platform 空白时返回空串（整段省略）。 */
    fun coreEnvironment(env: Environment): String {
        if (env.workdir.isBlank() || env.platform.isBlank()) return ""
        val lines = mutableListOf(
            "# 环境信息",
            "- 当前日期：${env.date ?: localDate()}（${env.timezone ?: timezone()}）",
            "- 平台：${env.platform}",
            "- 工作目录：${env.workdir}",
        )
        env.modelId?.let { lines.add("- 模型：$it") }
        return lines.joinToString("\n")
    }

    /** rendererId → 渲染函数（输入由调用方装配；未注册 id 返回 null → 能力校验失败路径）。 */
    fun registry(): Map<String, (RendererInput) -> String?> = mapOf(
        "tool.policy" to { input -> input.tools?.let { toolPolicy(it) } },
        "tool.guidance" to { input -> input.tools?.let { toolGuidance(it) } },
        "core.environment" to { input -> input.environment?.let { coreEnvironment(it) } },
    )

    data class RendererInput(
        val tools: List<ToolView>? = null,
        val environment: Environment? = null,
    )
}
