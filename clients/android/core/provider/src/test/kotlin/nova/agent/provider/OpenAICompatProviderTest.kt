package nova.agent.provider

import kotlinx.coroutines.test.runTest
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.SamplingConfig
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

class OpenAICompatProviderTest {

    private lateinit var server: MockWebServer
    private lateinit var provider: OpenAICompatProvider

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        provider = OpenAICompatProvider(
            baseUrl = server.url("/v1").toString().trimEnd('/'),
            apiKey = "sk-test",
            model = "deepseek-chat",
        )
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    private fun request(): ProviderRequest = ProviderRequest(
        model = "deepseek-chat",
        system = "你是网文助手",
        messages = listOf(
            LLMessage.User("续写第12章"),
            LLMessage.Assistant("我来改", toolCalls = listOf(nova.agent.model.ToolCall("c9", "t", "{}")), finishReason = FinishReason.TOOL_CALL),
            LLMessage.Tool("c9", "t", "结果"),
        ),
        tools = listOf(ToolSchema("t", "测试工具", kotlinx.serialization.json.buildJsonObject { })),
        sampling = SamplingConfig(temperature = 0.7),
    )

    @Test
    fun streamsTextReasoningAndToolCallFragments() = runTest {
        val sse = listOf(
            """data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}""",
            """data: {"choices":[{"delta":{"content":"你好"}}]}""",
            """data: {"choices":[{"delta":{"content":"，世界"}}]}""",
            """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"novel_write_paragraph","arguments":"{\"a\":"}}]}}]}""",
            """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1,\"b\":2}"}}]}}]}""",
            """data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":100,"completion_tokens":7}}""",
            """data: [DONE]""",
        ).joinToString("\n\n")
        server.enqueue(MockResponse().setBody(sse).setHeader("Content-Type", "text/event-stream"))

        val deltas = mutableListOf<ProviderDelta>()
        val result = provider.call(request()) { deltas.add(it) }

        // 文本与 reasoning delta 顺序
        assertEquals(
            listOf("思考中" to DeltaType.REASONING, "你好" to DeltaType.TEXT, "，世界" to DeltaType.TEXT),
            deltas.map { it.text to it.type },
        )
        // 拼装结果
        assertEquals("你好，世界", result.message.content)
        assertEquals("思考中", result.message.reasoning)
        assertEquals(FinishReason.TOOL_CALL, result.finishReason)
        assertEquals(1, result.message.toolCalls.size)
        val tc = result.message.toolCalls[0]
        assertEquals("call_1", tc.id)
        assertEquals("novel_write_paragraph", tc.name)
        assertEquals("""{"a":1,"b":2}""", tc.arguments)
        assertEquals(100, result.usage?.inputTokens)
        assertEquals(7, result.usage?.outputTokens)

        // 请求体：system 首位、tool 消息映射、stream 开启、schema 注入
        val recorded = server.takeRequest()
        val body = recorded.body.readUtf8()
        assertTrue(body.contains("\"stream\":true"))
        assertTrue(body.contains("include_usage"))
        assertTrue(body.contains("\"role\":\"system\""))
        assertTrue(body.contains("\"tool_call_id\":\"c9\""))
        // tools schema 注入（请求里的工具名是 "t"，schema 描述应进入请求体）
        assertTrue(body.contains("\"description\":\"测试工具\""))
        assertTrue(recorded.getHeader("Authorization") == "Bearer sk-test")
    }

    @Test
    fun plainTextCompletion() = runTest {
        val sse = listOf(
            """data: {"choices":[{"delta":{"content":"第12章"}}]}""",
            """data: {"choices":[{"delta":{"content":"续写完成"}}]}""",
            """data: {"choices":[{"delta":{},"finish_reason":"stop"}]}""",
            """data: [DONE]""",
        ).joinToString("\n\n")
        server.enqueue(MockResponse().setBody(sse).setHeader("Content-Type", "text/event-stream"))

        val result = provider.call(request()) { }
        assertEquals("第12章续写完成", result.message.content)
        assertEquals(FinishReason.STOP, result.finishReason)
        assertTrue(result.message.toolCalls.isEmpty())
    }

    @Test
    fun rateLimitClassified() = runTest {
        server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":{"message":"too many requests"}}"""))
        try {
            provider.call(request()) { }
            fail("应抛 ProviderException")
        } catch (e: ProviderException) {
            assertEquals(ProviderErrorKind.RATE_LIMIT, e.kind)
        }
    }

    @Test
    fun contextLengthClassifiedForFuse() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(400)
                .setBody("""{"error":{"message":"This model's maximum context length is 65536 tokens. However, you requested 70000 tokens."}}""")
        )
        try {
            provider.call(request()) { }
            fail("应抛 ProviderException")
        } catch (e: ProviderException) {
            assertEquals(ProviderErrorKind.CONTEXT_LENGTH, e.kind)
            assertTrue(e.isContextLength)
        }
    }

    @Test
    fun authErrorClassified() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"message":"Authentication Fails"}}"""))
        try {
            provider.call(request()) { }
            fail("应抛 ProviderException")
        } catch (e: ProviderException) {
            assertEquals(ProviderErrorKind.AUTH, e.kind)
        }
    }
}
