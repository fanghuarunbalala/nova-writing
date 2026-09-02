package nova.agent.tool

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** 工具执行上下文：工具可以看到自己在哪个会话哪一轮被调用（演示用，M4 可扩展 store 句柄）。 */
class ToolContext(
    val conversationId: String,
    val runSeq: Int,
)

/** 空参数 schema（无参工具用）。 */
fun emptyParameters(): kotlinx.serialization.json.JsonObject = buildJsonObject {
    put("type", "object")
    put("properties", buildJsonObject { })
}
