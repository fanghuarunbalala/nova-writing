package nova.agent.definition

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nova.agent.tool.ToolDef
import nova.agent.tool.emptyParameters
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 定义包测试：golden 夹具 = core TS 导出器产出的 1.5.0 全策略面包（对拍种子——
 * 双端读同一份 JSON，static 段文案/compact 参数/工具组清单逐字段一致）。
 */
class DefinitionBundleTest {

    private fun golden(): DefinitionBundle {
        val path: Path = Path.of(javaClass.classLoader.getResource("definition-novel-1.5.0.json")!!.toURI())
        return DefinitionBundleCodec.decode(Files.readString(path))
    }

    @Test
    fun parseGoldenFixture() {
        val bundle = golden()
        assertEquals(1, bundle.bundleSchemaVersion)
        assertEquals("1.5.0", bundle.definitionVersion)
        assertEquals("novel", bundle.agentType)
        assertEquals(15, bundle.prompt.recipe.size)
        assertEquals(6, bundle.prompt.recipe.count { it is RecipeItem.Static })
        assertEquals(9, bundle.prompt.recipe.count { it is RecipeItem.Dynamic })
        // 双端对拍种子：static 文案非空（identity 段）
        val identity = bundle.prompt.recipe.first() as RecipeItem.Static
        assertEquals("novel.identity", identity.sectionId)
        assertTrue(identity.content.isNotEmpty())
        assertEquals("2.0.0", (bundle.prompt.recipe[6] as RecipeItem.Dynamic).version)
        // 工具组 7 项
        assertEquals(7, bundle.tools.groups.size)
        assertTrue(bundle.tools.groups.first { it.groupId == "novel.entities" }.tools.contains("NovelWrite"))
        // nudge 5 项 + 触发方式
        assertEquals(5, bundle.nudges.size)
        assertEquals("both", bundle.nudges.first { it.nudgeId == "compose_mode" }.trigger)
        // compact 链
        assertEquals(listOf("t1-skeletonize", "t2-summarize", "t3-drop-oldest"), bundle.compact.chain.map { it.policyId })
    }

    @Test
    fun roundtripEncodeDecode() {
        val bundle = golden()
        val encoded = DefinitionBundleCodec.encode(bundle)
        val decoded = DefinitionBundleCodec.decode(encoded)
        assertEquals(bundle, decoded)
    }

    @Test
    fun assembleSystemPromptStaticsInRecipeOrder() = runTest {
        val assembler = DefinitionAssembler(golden())
        // 不传渲染器：static 按 legacy 规则拼接（单 \n，空段不过滤），dynamic 缺省省略
        val prompt = assembler.assembleSystemPrompt()
        val statics = golden().prompt.recipe.filterIsInstance<RecipeItem.Static>()
        assertEquals(statics.map { it.content }.joinToString("\n"), prompt)
        // 传渲染器：dynamic 段追加（以单 \n 连接）
        val withRenderer = assembler.assembleSystemPrompt { it.rendererId }
        assertTrue(withRenderer.contains("novel.story_appeal"))
        assertTrue(withRenderer.length > prompt.length)
    }

    @Test
    fun capabilityValidation() {
        val assembler = DefinitionAssembler(golden())
        val req = assembler.requirements()
        // 全能力 → 通过
        assertEquals(emptyList(), assembler.validateCapabilities(
            DefinitionAssembler.Capabilities(
                renderers = req.renderers, policies = req.policies, triggers = req.triggers, toolGroups = req.toolGroups,
            )
        ))
        // 缺一个渲染器 → 精确报缺失（整包拒绝语义）
        val missing = assembler.validateCapabilities(
            DefinitionAssembler.Capabilities(
                renderers = req.renderers - "tool.policy",
                policies = req.policies, triggers = req.triggers, toolGroups = req.toolGroups,
            )
        )
        assertEquals(listOf("renderer:tool.policy"), missing)
    }

    @Test
    fun compactionConfigFromBundleParams() {
        val config = DefinitionAssembler(golden()).toCompactionConfig(contextWindowTokens = 128_000)
        // golden 包的 compact 参数 = 桌面缺省值（t1Ratio 0.7 / margin 12000 / cap 0.92 / 2048 / 1 / 3）
        assertEquals(128_000, config.contextWindowTokens)
        assertEquals(0.70, config.t1ThresholdRatio)
        assertEquals(12_000, config.t2ReserveTokens)
        assertEquals(0.92, config.t3ThresholdRatio, 1e-9)
        assertEquals(2_048, config.maxOutputTokens)
        assertEquals(1, config.keepFirstRuns)
        assertEquals(3, config.keepLastRuns)
    }

    @Test
    fun toolPolicyFilterAndApprovalOverride() {
        val novelRead = tool("NovelRead", requireApproval = false)
        val novelWrite = tool("NovelWrite", requireApproval = true)
        val todoWrite = tool("TodoWrite", requireApproval = false)
        // 包内 novel.entities 组只含 NovelRead/NovelWrite/NovelEdit/NovelDelete（golden 夹具）
        val assembler = DefinitionAssembler(golden())
        val effective = assembler.applyToolPolicy(listOf(novelRead, novelWrite, todoWrite))
        // golden 含 7 组，本地提供的工具中命中 TodoWrite(runtime.todo) + NovelRead/NovelWrite(novel.entities)，按组插入序
        assertEquals(listOf("TodoWrite", "NovelRead", "NovelWrite"), effective.map { it.name })
        assertEquals(false, effective.first { it.name == "NovelRead" }.requireApproval)
        assertEquals(true, effective.first { it.name == "NovelWrite" }.requireApproval)

        // 审批覆盖：改包即变审批面——NovelWrite 覆盖为免审
        val overridden = golden().copy(
            tools = golden().tools.copy(
                overrides = mapOf("NovelWrite" to ToolOverride(requireApproval = false))
            )
        )
        val effective2 = DefinitionAssembler(overridden).applyToolPolicy(listOf(novelRead, novelWrite, todoWrite))
        assertEquals(false, effective2.first { it.name == "NovelWrite" }.requireApproval)
    }

    private fun tool(name: String, requireApproval: Boolean) = ToolDef(
        name = name,
        description = "$name 工具",
        parameters = buildJsonObject {
            put("type", "object")
            put("properties", buildJsonObject { })
        },
        requireApproval = requireApproval,
        handler = { _, _ -> "ok" },
    )
}
