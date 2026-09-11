package nova.agent.net.definition

import kotlinx.coroutines.test.runTest
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp
import nova.agent.net.support.fixedAuthSession
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

class DefinitionClientTest {

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: java.nio.file.Path
    private lateinit var client: DefinitionClient

    private val bundleV1 = """
        {"bundleSchemaVersion":1,"definitionVersion":"1.0.0","agentType":"novel",
         "prompt":{"recipe":[{"kind":"static","sectionId":"core","version":"1","content":"系统提示"}]},
         "compact":{"chain":[{"policyId":"t1_skeleton","params":{}}]}}
    """.trimIndent()

    private val bundleV2 = bundleV1.replace("1.0.0", "2.0.0")

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        cacheDir = Files.createTempDirectory("nova-defs")
        client = DefinitionClient(ServerHttp(server.url("").toString().trimEnd('/')), fixedAuthSession("http://x"), cacheDir)
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    private fun json(code: Int, body: String): MockResponse =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun resolveDecodesAndPersistsCache() = runTest {
        server.enqueue(json(200, """{"bundle":$bundleV2,"requirements":{"renderers":[],"policies":[],"triggers":[],"toolGroups":[]},"etag":"\"abc\""}"""))
        val bundle = client.resolve(capabilities = kotlinx.serialization.json.buildJsonObject { })
        assertEquals("2.0.0", bundle.definitionVersion)
        assertTrue(Files.exists(cacheDir.resolve("definitions/2.0.0.json")))

        val recorded = server.takeRequest()
        assertEquals("/v1/definitions/resolve", recorded.path)
    }

    @Test
    fun noCompatibleFallsBackToCachedOlderVersion() = runTest {
        // 先缓存 1.0.0
        Files.createDirectories(cacheDir.resolve("definitions"))
        Files.writeString(cacheDir.resolve("definitions/1.0.0.json"), bundleV1)

        server.enqueue(json(404, """{"code":"no_compatible_definition","message":"当前端能力无法装配任何已发布定义包"}"""))
        val bundle = client.resolve(capabilities = kotlinx.serialization.json.buildJsonObject { })
        assertEquals("1.0.0", bundle.definitionVersion)
    }

    @Test
    fun noCompatibleAndNoCacheThrows() = runTest {
        server.enqueue(json(404, """{"code":"no_compatible_definition","message":"请升级 App"}"""))
        try {
            client.resolve(capabilities = kotlinx.serialization.json.buildJsonObject { })
            fail("无缓存可回退应原样上抛")
        } catch (e: ServerApiException) {
            assertEquals(404, e.status)
            assertEquals("no_compatible_definition", e.code)
        }
    }

    @Test
    fun corruptCachedFileIsSkippedInFallback() = runTest {
        Files.createDirectories(cacheDir.resolve("definitions"))
        Files.writeString(cacheDir.resolve("definitions/3.0.0.json"), "not-json")
        Files.writeString(cacheDir.resolve("definitions/1.0.0.json"), bundleV1)

        server.enqueue(json(404, """{"code":"no_compatible_definition","message":""}"""))
        val bundle = client.resolve(capabilities = kotlinx.serialization.json.buildJsonObject { })
        assertEquals("1.0.0", bundle.definitionVersion)
    }
}
