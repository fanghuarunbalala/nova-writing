package nova.agent.net.project

import kotlinx.coroutines.test.runTest
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp
import nova.agent.net.support.fixedAuthSession
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

class CloudProjectsClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: CloudProjectsClient

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = CloudProjectsClient(ServerHttp(server.url("").toString().trimEnd('/')), fixedAuthSession("http://x"))
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    private fun json(code: Int, body: String): MockResponse =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun listProjects() = runTest {
        server.enqueue(json(200, """{"projects":[{"id":"p1","name":"长夜余烬","createdAt":1,"lastActivityAt":9}]}"""))
        val projects = client.list()
        assertEquals(1, projects.size)
        assertEquals("长夜余烬", projects[0].name)
        assertEquals(9, projects[0].lastActivityAt)
    }

    @Test
    fun createProject201() = runTest {
        server.enqueue(json(201, """{"id":"p2","name":"新书"}"""))
        val p = client.create("新书")
        assertEquals("p2", p.id)
        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains(""""name":"新书""""))
    }

    @Test
    fun renameReturnsProjectWrapper() = runTest {
        server.enqueue(json(200, """{"project":{"id":"p1","name":"新名","createdAt":1}}"""))
        val p = client.rename("p1", "新名")
        assertEquals("新名", p.name)
        assertEquals("PATCH", server.takeRequest().method)
    }

    @Test
    fun removeExpects204() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))
        client.remove("p1")
        assertEquals("DELETE", server.takeRequest().method)
    }

    @Test
    fun fileWriteConflictCarriesCurrentUpdatedAt() = runTest {
        server.enqueue(json(409, """{"code":"stale_file","message":"文件已被并发修改","currentUpdatedAt":777}"""))
        try {
            client.writeFile("p1", "notes/x.md", "内容", expectedUpdatedAt = 5)
            fail("应抛 ServerApiException")
        } catch (e: ServerApiException) {
            assertEquals("stale_file", e.code)
            assertEquals("777", e.extras["currentUpdatedAt"]!!.toString().trim('"'))
        }
    }

    @Test
    fun novelMdRequiresApprovalPassesThrough() = runTest {
        server.enqueue(json(403, """{"code":"novel_md_requires_approval","message":"NOVEL.md 只能经审批提案变更"}"""))
        try {
            client.writeFile("p1", "NOVEL.md", "内容")
            fail("应抛 403 novel_md_requires_approval")
        } catch (e: ServerApiException) {
            assertEquals(403, e.status)
            assertEquals("novel_md_requires_approval", e.code)
        }
    }

    @Test
    fun fileTooLargeIs413() = runTest {
        server.enqueue(json(413, """{"code":"too_large","message":"单文件 ≤512KiB"}"""))
        try {
            client.writeFile("p1", "chapters/a.md", "x".repeat(600_000))
            fail("应抛 413")
        } catch (e: ServerApiException) {
            assertEquals(413, e.status)
        }
    }

    @Test
    fun domainSnapshotAndDelta() = runTest {
        server.enqueue(json(200, """{"cursor":2,"entities":[{"id":"m_1","kind":"novel_mutation","entityVersion":1,"data":{"sessionTag":"s1","mutation":{"op":"write","id":"p-1"}},"seq":1}]}"""))
        val snapshot = client.domainSnapshot("p1")
        assertEquals(2, snapshot.cursor)
        assertEquals(1, snapshot.entities.size)
        assertEquals("novel_mutation", snapshot.entities[0].kind)

        server.enqueue(json(200, """{"cursor":5,"entities":[]}"""))
        val delta = client.domainDelta("p1", since = 2)
        assertEquals(5, delta.cursor)
        assertTrue(delta.entities.isEmpty())
    }

    @Test
    fun domainMutateStaleRevisionCarriesCurrentVersion() = runTest {
        server.enqueue(json(409, """{"code":"stale_revision","currentVersion":4,"message":"版本过期"}"""))
        try {
            client.domainMutate(
                "p1", "c1", "lt-1",
                listOf(DomainMutation(kind = "novel_mutation", id = "m_x", op = "put", baseVersion = 3)),
            )
            fail("应抛 409")
        } catch (e: ServerApiException) {
            assertEquals("stale_revision", e.code)
            assertEquals("4", e.extras["currentVersion"]!!.toString().trim('"'))
        }
    }
}
