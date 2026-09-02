package nova.agent.tool

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import nova.agent.model.ToolCall
import nova.agent.provider.ToolSchema

/**
 * 工具三件套（桌面端 core/src/runtime/tool 对应物）：
 * ToolDef（定义+schema+handler+审批策略元数据）→ ToolRegistry（注册表）→ ToolDispatcher（查表执行）。
 *
 * 对齐桌面端的两点：
 * 1. arguments 是原始 JSON 串，handler 内自行解析校验（无独立 schema 校验器）；
 * 2. 工具异常不取消 run——错误文本回填为 tool 消息，模型下轮自纠。
 */

/** 解析后的工具调用请求（args 为已解析的 JSON 对象）。 */
class ToolCallRequest(
    val id: String,
    val name: String,
    val args: JsonObject,
)

enum class ToolErrorCode { NOT_AVAILABLE, DUPLICATE, ARGUMENTS_INVALID, PRECHECK_FAILED, HANDLER_FAILED }

class ToolException(val code: ToolErrorCode, message: String) : RuntimeException(message)

class ToolDef(
    val name: String,
    val description: String,
    val parameters: JsonObject,
    val version: String = "1",
    /** 为 true 时执行前先过审批门（gateBatch 按 turn 批量征询）。 */
    val requireApproval: Boolean = false,
    /** 审批提交前的只读预检：存在性 / 乐观锁版本 / id 占用。失败抛 ToolException(PRECHECK_FAILED)。 */
    val precheck: (suspend (ToolCallRequest) -> Unit)? = null,
    val handler: suspend (ToolCallRequest, ToolContext) -> String,
)

class ToolRegistry {
    private val tools = LinkedHashMap<String, ToolDef>()

    fun register(def: ToolDef) {
        if (tools.containsKey(def.name)) {
            throw ToolException(ToolErrorCode.DUPLICATE, "工具重复注册: ${def.name}")
        }
        tools[def.name] = def
    }

    fun get(name: String): ToolDef? = tools[name]

    fun list(): List<ToolDef> = tools.values.toList()
}

class ToolDispatcher(
    private val registry: ToolRegistry,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    /** 注入 provider 请求的 schema 列表（schema 与 handler 分离的「schema 面」）。 */
    fun schemas(): List<ToolSchema> = registry.list().map {
        ToolSchema(name = it.name, description = it.description, parameters = it.parameters)
    }

    fun requiresApproval(name: String): Boolean = registry.get(name)?.requireApproval ?: false

    suspend fun dispatch(call: ToolCall, context: ToolContext): String {
        val def = registry.get(call.name)
            ?: throw ToolException(ToolErrorCode.NOT_AVAILABLE, "未知工具: ${call.name}")
        val args = try {
            json.parseToJsonElement(call.arguments).let { it as? JsonObject }
                ?: throw ToolException(ToolErrorCode.ARGUMENTS_INVALID, "参数必须是 JSON 对象: ${call.arguments.take(100)}")
        } catch (e: ToolException) {
            throw e
        } catch (e: Exception) {
            throw ToolException(ToolErrorCode.ARGUMENTS_INVALID, "参数 JSON 解析失败: ${e.message}")
        }
        val request = ToolCallRequest(id = call.id, name = call.name, args = args)
        def.precheck?.invoke(request)
        return def.handler(request, context)
    }
}
