package nova.agent.provider

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.Usage
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * OpenAI 兼容端点的流式 Provider（DeepSeek / OpenAI / 任意兼容 baseUrl）。
 *
 * 不引官方 SDK：SSE 自己用 OkHttp 逐行解析。取消桥接是本类的关键设计——
 * 阻塞式 readLine 不响应协程取消，所以读循环跑在 IO 子协程里，主协程 await
 * CompletableDeferred；一旦外层取消，立即 call.cancel() 掐断 socket 强制解阻塞，
 * 读协程随之收尾，不泄漏线程、不悬挂请求。
 */
class OpenAICompatProvider(
    /** 形如 https://api.deepseek.com/v1，结尾不带斜杠。 */
    private val baseUrl: String,
    private val apiKey: String,
    private val model: String,
    private val timeoutMs: Long = 300_000,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .connectTimeout(30, TimeUnit.SECONDS)
        .build(),
    private val json: Json = Json { ignoreUnknownKeys = true },
) : Provider {

    override suspend fun call(
        request: ProviderRequest,
        onDelta: suspend (ProviderDelta) -> Unit,
    ): ProviderResult {
        val httpRequest = Request.Builder()
            .url("$baseUrl/chat/completions")
            .header("Authorization", "Bearer $apiKey")
            .header("Accept", "text/event-stream")
            .post(buildRequestBody(request).toString().toRequestBody("application/json".toMediaType()))
            .build()
        val call = client.newCall(httpRequest)

        return coroutineScope {
            val finished = CompletableDeferred<ProviderResult>()
            val reader = launch(Dispatchers.IO, start = CoroutineStart.ATOMIC) {
                try {
                    finished.complete(blockingStream(call, onDelta))
                } catch (cancelled: CancellationException) {
                    finished.cancel(cancelled)
                } catch (t: Throwable) {
                    finished.completeExceptionally(t)
                }
            }
            try {
                finished.await()
            } catch (e: CancellationException) {
                call.cancel() // 掐断 socket → readLine 立刻抛 IOException → reader 收尾
                throw e
            }
        }
    }

    /** 阻塞式 SSE 循环，运行在 IO 协程。 */
    private suspend fun blockingStream(
        call: Call,
        onDelta: suspend (ProviderDelta) -> Unit,
    ): ProviderResult = withContext(Dispatchers.IO) {
        call.execute().use { response ->
            if (!response.isSuccessful) {
                val errBody = try { response.body?.string().orEmpty() } catch (_: IOException) { "" }
                throw ProviderException.fromHttpStatus(response.code, errBody)
            }
            val source = response.body ?: throw ProviderException(ProviderErrorKind.SERVER, "空响应体")
            val acc = Accumulator()
            val reader = source.byteStream().bufferedReader()
            while (true) {
                currentCoroutineContext().ensureActive()
                val line = try {
                    reader.readLine() ?: break
                } catch (e: IOException) {
                    // 区分「协程已取消（socket 被掐断）」与真实网络错误
                    currentCoroutineContext().ensureActive()
                    throw ProviderException(ProviderErrorKind.NETWORK, "SSE 读取中断: ${e.message}")
                }
                if (!line.startsWith("data:")) continue
                val payload = line.removePrefix("data:").trim()
                if (payload.isEmpty()) continue
                if (payload == "[DONE]") break
                acc.consume(json.parseToJsonElement(payload).jsonObject, onDelta)
            }
            acc.build()
        }
    }

    private fun buildRequestBody(request: ProviderRequest): kotlinx.serialization.json.JsonObject = buildJsonObject {
        put("model", model)
        put("stream", true)
        put("temperature", request.sampling.temperature)
        put("top_p", request.sampling.topP)
        request.maxTokens?.let { put("max_tokens", it) }
        put("stream_options", buildJsonObject { put("include_usage", true) })
        put("messages", buildJsonArray {
            add(buildJsonObject {
                put("role", "system"); put("content", request.system)
            })
            request.messages.forEach { m -> add(m.toJson()) }
        })
        if (request.tools.isNotEmpty()) {
            put("tools", buildJsonArray {
                request.tools.forEach { t ->
                    add(buildJsonObject {
                        put("type", "function")
                        put("function", buildJsonObject {
                            put("name", t.name)
                            put("description", t.description)
                            put("parameters", t.parameters)
                        })
                    })
                }
            })
        }
    }

    private fun LLMessage.toJson(): kotlinx.serialization.json.JsonObject = when (this) {
        is LLMessage.User -> buildJsonObject {
            put("role", "user"); put("content", content)
        }
        is LLMessage.Assistant -> buildJsonObject {
            put("role", "assistant")
            put("content", content)
            if (toolCalls.isNotEmpty()) {
                put("tool_calls", buildJsonArray {
                    toolCalls.forEach { tc ->
                        add(buildJsonObject {
                            put("id", tc.id)
                            put("type", "function")
                            put("function", buildJsonObject {
                                put("name", tc.name)
                                put("arguments", tc.arguments)
                            })
                        })
                    }
                })
            }
        }
        is LLMessage.Tool -> buildJsonObject {
            put("role", "tool")
            put("tool_call_id", toolCallId)
            put("content", content)
        }
        is LLMessage.System -> buildJsonObject {
            put("role", "system"); put("content", content)
        }
    }

    /** SSE 分片累积器：content/reasoning 直拼；tool_calls 按 index 拼 id/name/args 分片。 */
    private class Accumulator {
        private val content = StringBuilder()
        private val reasoning = StringBuilder()
        private val toolCalls = sortedMapOf<Int, ToolCallAcc>()
        private var finishReason: FinishReason = FinishReason.STOP
        private var usage: Usage? = null

        suspend fun consume(obj: kotlinx.serialization.json.JsonObject, onDelta: suspend (ProviderDelta) -> Unit) {
            obj["usage"]?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.let { u ->
                val o = u.jsonObject
                usage = Usage(
                    inputTokens = o["prompt_tokens"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0,
                    outputTokens = o["completion_tokens"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0,
                )
            }
            val choices = obj["choices"]?.jsonArray ?: return
            if (choices.isEmpty()) return
            val choice = choices[0].jsonObject
            (choice["finish_reason"] as? kotlinx.serialization.json.JsonPrimitive)
                ?.takeIf { it.content != "null" && it.content.isNotEmpty() }
                ?.let { finishReason = normalizeFinish(it.content) }

            val delta = (choice["delta"] as? kotlinx.serialization.json.JsonObject) ?: return
            delta["content"]?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }?.let {
                content.append(it)
                onDelta(ProviderDelta(DeltaType.TEXT, it))
            }
            delta["reasoning_content"]?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }?.let {
                reasoning.append(it)
                onDelta(ProviderDelta(DeltaType.REASONING, it))
            }
            delta["tool_calls"]?.jsonArray?.forEach { tcEl ->
                val tc = tcEl.jsonObject
                val index = tc["index"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
                val acc = toolCalls.getOrPut(index) { ToolCallAcc() }
                tc["id"]?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }?.let { acc.id = it }
                (tc["function"] as? kotlinx.serialization.json.JsonObject)?.let { fn ->
                    fn["name"]?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }?.let { acc.name = it }
                    fn["arguments"]?.jsonPrimitive?.content?.let { acc.args.append(it) }
                }
            }
        }

        fun build(): ProviderResult {
            val calls = toolCalls.values.mapIndexed { i, acc ->
                nova.agent.model.ToolCall(
                    id = acc.id ?: "call_$i",
                    name = acc.name ?: error("tool_calls 缺少 function.name"),
                    arguments = acc.args.toString().ifEmpty { "{}" },
                )
            }
            val message = LLMessage.Assistant(
                content = content.toString(),
                reasoning = reasoning.toString(),
                toolCalls = calls,
                finishReason = if (calls.isNotEmpty()) FinishReason.TOOL_CALL else finishReason,
            )
            return ProviderResult(message, usage)
        }

        private fun normalizeFinish(raw: String): FinishReason = when (raw) {
            "tool_calls", "function_call" -> FinishReason.TOOL_CALL
            "length" -> FinishReason.LENGTH
            else -> FinishReason.STOP
        }
    }

    private class ToolCallAcc {
        var id: String? = null
        var name: String? = null
        val args = StringBuilder()
    }
}
