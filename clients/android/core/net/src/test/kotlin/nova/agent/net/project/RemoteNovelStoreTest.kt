package nova.agent.net.project

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

class RemoteNovelStoreTest {

    private lateinit var server: MockWebServer
    private lateinit var projects: CloudProjectsClient
    private var lease: String? = "lt-1"

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        projects = CloudProjectsClient(ServerHttp(server.url("").toString().trimEnd('/')), fixedAuthSession("http://x"))
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    private fun json(code: Int, body: String): MockResponse =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun oplog(seq: Long, tag: String, id: String, op: String = "write", baseRevision: Int? = null): String {
        val data = """{"sessionTag":"$tag","mutation":{"op":"$op","id":"$id","storyUnitId":"u1","orderKey":1,"text":"正文-$id"${baseRevision?.let { ""","baseRevision":$it""" } ?: ""}}}"""
        return """{"id":"m_$seq","kind":"novel_mutation","seq":$seq,"data":$data}"""
    }

    private fun store(tag: String = "s-me", cache: java.nio.file.Path? = null) = RemoteNovelStore(
        projects = projects,
        projectId = "p1",
        sessionTag = tag,
        getLeaseToken = { lease },
        getConversationId = { "c1" },
        cachePath = cache,
    )

    @Test
    fun initSnapshotProjectsAndDeltaSyncs() = runTest {
        server.enqueue(json(200, """{"cursor":1,"entities":[${oplog(1, "s-desktop", "p-1")}]}"""))
        server.enqueue(json(200, """{"cursor":1,"entities":[]}""")) // 首个 query 的 delta

        val store = store()
        var paragraphs = store.query()
        assertEquals(1, paragraphs.size)
        assertEquals("正文-p-1", paragraphs[0].text)

        // 他端新写入 → 下次 query 前 delta 增量收敛
        server.enqueue(json(200, """{"cursor":2,"entities":[${oplog(2, "s-desktop", "p-2")}]}"""))
        paragraphs = store.query()
        assertEquals(2, paragraphs.size)
    }

    @Test
    fun sessionTagSelfEntriesSkippedOnSync() = runTest {
        server.enqueue(json(200, """{"cursor":1,"entities":[${oplog(1, "s-desktop", "p-1")}]}""")) // 他端 → 应用
        server.enqueue(json(200, """{"cursor":1,"entities":[]}"""))
        val store = store(tag = "s-me")
        assertEquals(1, store.query().size)

        // sync 拉回自身条目(s-me)→ 跳过(本地已应用,不重复——sessionTag 进程唯一的意义所在)
        server.enqueue(json(200, """{"cursor":3,"entities":[${oplog(3, "s-me", "p-3")}]}"""))
        assertEquals(1, store.query().size) // p-3 不入投影
    }

    @Test
    fun mutateUploadsOplogAndAppliesLocally() = runTest {
        server.enqueue(json(200, """{"cursor":0,"entities":[]}""")) // init snapshot
        server.enqueue(json(200, """{"results":[{"id":"m_x","kind":"novel_mutation","entityVersion":1}],"seq":1}""")) // 上推
        server.enqueue(json(200, """{"cursor":1,"entities":[]}""")) // 上推后的 sync delta

        val store = store()
        val result = store.mutate(NovelMutation(op = "write", id = "p-9", storyUnitId = "u1", orderKey = 1, text = "新段"))
        assertTrue(result.contains("p-9"))

        val recorded = server.takeRequest() // snapshot
        val upload = server.takeRequest() // POST domain/mutate
        assertEquals("POST", upload.method)
        val body = upload.body.readUtf8()
        assertTrue(body.contains(""""kind":"novel_mutation""""))
        assertTrue(body.contains(""""sessionTag":"s-me""""))
        assertTrue(body.contains(""""conversationId":"c1""""))
        assertTrue(body.contains(""""leaseToken":"lt-1""""))
    }

    @Test
    fun uploadFailureThrowsAndDoesNotPropagateDivergence() = runTest {
        server.enqueue(json(200, """{"cursor":0,"entities":[]}"""))
        server.enqueue(json(500, """{"code":"boom"}"""))
        val store = store()
        try {
            store.mutate(NovelMutation(op = "write", id = "p-x", storyUnitId = "u1", orderKey = 1, text = "x"))
            fail("上推失败应抛")
        } catch (e: ServerApiException) {
            assertEquals(500, e.status)
        }
    }

    @Test
    fun cacheHitSkipsSnapshotAndCorruptCacheFallsBack() = runTest {
        val dir = Files.createTempDirectory("nova-domain-cache")
        val cache = dir.resolve("domain-snapshot.json")
        val snapshotPaths = mutableListOf<String>()
        // 带超时轮询:无参 takeRequest() 会永久阻塞
        fun drainRequests() {
            while (true) {
                val r = server.takeRequest(1, java.util.concurrent.TimeUnit.SECONDS) ?: return
                if (r.path!!.contains("/domain/snapshot")) snapshotPaths += r.path!!
            }
        }

        // 第一次:init 全量 snapshot + 落缓存
        server.enqueue(json(200, """{"cursor":1,"entities":[${oplog(1, "s-desktop", "p-1")}]}"""))
        server.enqueue(json(200, """{"cursor":1,"entities":[]}"""))
        val first = store(cache = cache)
        assertEquals(1, first.query().size)
        assertTrue(java.nio.file.Files.exists(cache))
        drainRequests()
        assertEquals(1, snapshotPaths.size)

        // 第二个实例(同缓存文件):init 命中缓存 → 不再发 snapshot,只有 delta
        server.enqueue(json(200, """{"cursor":1,"entities":[]}"""))
        val second = store(cache = cache)
        assertEquals(1, second.query().size)
        drainRequests()
        assertEquals(1, snapshotPaths.size, "缓存命中应免全量 snapshot")

        // 缓存损坏 → 按未命中回退全量
        Files.writeString(cache, """{"version":9,"garbage":""")
        server.enqueue(json(200, """{"cursor":1,"entities":[${oplog(1, "s-desktop", "p-1")}]}"""))
        server.enqueue(json(200, """{"cursor":1,"entities":[]}"""))
        val third = store(cache = cache)
        assertEquals(1, third.query().size)
        drainRequests()
        assertEquals(2, snapshotPaths.size, "损坏缓存应回退全量 snapshot")
    }
}
