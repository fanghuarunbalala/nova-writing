package nova.agent.definition

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 双端对拍（层1/2 种子）：Kotlin 渲染器输出 == TS 端同夹具渲染的
 * parity-sections.json（core 侧 assembler.test.ts 以 WRITE_PARITY=1 生成）。
 * 四层对拍 CI 门禁的 Kotlin 半边——TS 半边在 core 测试内锚定格式。
 */
class DynamicRendererParityTest {

    private fun fixture(): Map<String, kotlinx.serialization.json.JsonElement> {
        val path = Path.of(javaClass.classLoader.getResource("parity-sections.json")!!.toURI())
        return Json.parseToJsonElement(Files.readString(path)).jsonObject
    }

    private fun fixtureTools(): List<DynamicRenderers.ToolView> =
        fixture().getValue("fixtureTools").jsonArray.map { el ->
            val o = el.jsonObject
            DynamicRenderers.ToolView(
                name = o.getValue("name").jsonPrimitive.content,
                policy = (o["policy"] as? kotlinx.serialization.json.JsonPrimitive)?.content,
                guidance = (o["guidance"] as? kotlinx.serialization.json.JsonPrimitive)?.content,
            )
        }

    @Test
    fun toolPolicyByteParity() {
        val expected = fixture().getValue("toolPolicy").jsonPrimitive.content
        val actual = DynamicRenderers.toolPolicy(fixtureTools())
        assertEquals(expected, actual)
        // 关键字节锚点（失败时先看这两个）
        assertTrue(actual.startsWith("# Using Tools\n"))
        assertTrue(actual.contains("\n- available tools: TodoWrite, NovelRead, NovelWrite, Read;\n"))
    }

    @Test
    fun toolGuidanceByteParity() {
        val expected = fixture().getValue("toolGuidance").jsonPrimitive.content
        val actual = DynamicRenderers.toolGuidance(fixtureTools())
        assertEquals(expected, actual)
    }

    @Test
    fun coreEnvironmentByteParity() {
        val expected = fixture().getValue("environment").jsonPrimitive.content
        // 日期行注入对拍日的本地日期（跨午夜执行 TS 生成与 Kotlin 对拍可能差一天——按行归一化比较）
        val env = DynamicRenderers.Environment(
            workdir = "/workspace/nova",
            platform = "darwin",
            modelId = "deepseek-chat",
            date = null, // 现场计算，与 TS 同机器同时区
        )
        val actual = DynamicRenderers.coreEnvironment(env)
        val normalize: (String) -> List<String> = { text ->
            text.split("\n").map { line -> if (line.startsWith("- 当前日期：")) "- 当前日期：<date>" else line }
        }
        assertEquals(normalize(expected), normalize(actual))
        // 日期行格式锚点
        assertTrue(Regex("- 当前日期：\\d{4}-\\d{2}-\\d{2}（.+）").containsMatchIn(actual))
    }

    @Test
    fun emptyToolsPlaceholder() {
        assertEquals(
            "No Tools are available in this Agent Manifest. Do not simulate Tool execution.",
            DynamicRenderers.toolPolicy(emptyList()),
        )
    }

    @Test
    fun registryCoversFirstBatchRenderers() {
        val registry = DynamicRenderers.registry()
        assertEquals(setOf("tool.policy", "tool.guidance", "core.environment"), registry.keys)
    }

    @Test
    fun fullAssemblyUsesLegacySeparator() = runTest {
        // golden 包 static 拼接遵循 legacy 规则：单 \n，空 static 段保留占位（core.runtime.protocol 为空串）
        val bundlePath = Path.of(javaClass.classLoader.getResource("definition-novel-1.5.0.json")!!.toURI())
        val assembler = DefinitionAssembler(DefinitionBundleCodec.decode(Files.readString(bundlePath)))
        val prompt = assembler.assembleSystemPrompt()
        val statics = DefinitionBundleCodec.decode(Files.readString(bundlePath))
            .prompt.recipe.filterIsInstance<RecipeItem.Static>().map { it.content }
        assertEquals(statics.joinToString("\n"), prompt)
        // 空 static 段不过滤：总长度 = 各段之和 + (n-1) 个 \n
        assertEquals(statics.sumOf { it.length } + (statics.size - 1), prompt.length)
    }
}
