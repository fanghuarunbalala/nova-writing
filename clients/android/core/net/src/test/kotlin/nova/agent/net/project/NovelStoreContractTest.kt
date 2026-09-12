package nova.agent.net.project

import kotlinx.coroutines.test.runTest
import nova.agent.net.http.ServerHttp
import nova.agent.net.support.fixedAuthSession
import nova.agent.tool.novel.InMemoryNovelStore
import nova.agent.tool.novel.NovelStore
import nova.agent.tool.ToolException
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith

/**
 * NovelStore 双实现同契约（M4 阶段3 runtime 扩展①）：
 * InMemory（进程内）与 Remote（云域投影 + oplog 上推）走同一套断言——
 * write 未知 id 即新建 / baseRevision 过期抛 ToolException / delete 未知 id 抛错。
 */
class NovelStoreContractTest {

    private lateinit var server: MockWebServer

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    private fun json(code: Int, body: String): MockResponse =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun delta() = json(200, """{"cursor":1,"entities":[]}""")

    private fun mutateOk() = json(200, """{"results":[{"id":"m_x","kind":"novel_mutation","entityVersion":1}],"seq":1}""")

    private fun remoteStore(): NovelStore = RemoteNovelStore(
        projects = CloudProjectsClient(ServerHttp(server.url("").toString().trimEnd('/')), fixedAuthSession("http://x")),
        projectId = "p1",
        sessionTag = "s-contract",
        getLeaseToken = { "lt-1" },
        getConversationId = { "c1" },
    )

    private suspend fun contract(store: NovelStore) {
        val r1 = store.write("p-1", "u-1", 1, "正文一", null)
        assertTrue(r1.contains("p-1"))
        store.write("p-2", "u-2", 1, "正文二", null)
        assertEquals(2, store.query().size)
        assertEquals(1, store.query("u-1").size)

        val p1 = store.paragraph("p-1")
        assertEquals("正文一", p1?.text)
        assertEquals(1, p1?.entityVersion)

        store.write("p-1", "u-1", 2, "正文一改", baseRevision = 1)
        assertEquals(2, store.paragraph("p-1")?.entityVersion)

        // 乐观锁过期：本地拒绝，不让模型基于旧版本发散
        assertFailsWith<ToolException> { store.write("p-1", "u-1", 1, "过期写", baseRevision = 1) }
        assertFailsWith<ToolException> { store.delete("p-404", null) }

        val d = store.delete("p-1", 2)
        assertTrue(d.contains("p-1"))
        assertNull(store.paragraph("p-1"))
    }

    @Test
    fun inMemorySatisfiesContract() = runTest {
        contract(InMemoryNovelStore())
    }

    @Test
    fun remoteSatisfiesContract() = runTest {
        // 响应按 RemoteNovelStore 的调用序预置：init snapshot → (mutate + sync delta)×N → 读前 delta
        server.enqueue(json(200, """{"cursor":0,"entities":[]}""")) // init snapshot
        server.enqueue(mutateOk()); server.enqueue(delta())          // write p-1
        server.enqueue(mutateOk()); server.enqueue(delta())          // write p-2
        server.enqueue(delta())                                       // query()
        server.enqueue(delta())                                       // query("u-1")
        server.enqueue(delta())                                       // paragraph p-1
        server.enqueue(mutateOk()); server.enqueue(delta())          // update p-1 (base=1)
        server.enqueue(delta())                                       // paragraph p-1 (v2)
        // 乐观锁过期 / delete p-404：applyLocal 先抛，不上服务器
        server.enqueue(mutateOk()); server.enqueue(delta())          // delete p-1
        server.enqueue(delta())                                       // paragraph p-1 (null)

        contract(remoteStore())
    }
}
