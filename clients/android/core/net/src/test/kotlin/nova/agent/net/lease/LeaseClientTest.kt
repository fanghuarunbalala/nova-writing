package nova.agent.net.lease

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import nova.agent.net.http.ServerHttp
import nova.agent.net.support.fixedAuthSession
import nova.agent.net.support.waitFor
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

class LeaseClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: LeaseClient

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = LeaseClient(ServerHttp(server.url("").toString().trimEnd('/')), fixedAuthSession("http://x"))
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    private fun json(code: Int, body: String): MockResponse =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun acquireParsesGrant() = runBlocking {
        server.enqueue(json(200, """{"leaseToken":"lt-1","expiresAt":123456,"renewed":false}"""))
        val grant = client.acquire("c1")
        assertEquals("lt-1", grant.leaseToken)
        assertEquals(123456, grant.expiresAt)

        val recorded = server.takeRequest()
        assertEquals("/v1/leases", recorded.path)
        assertTrue(recorded.body.readUtf8().contains(""""conversationId":"c1""""))
    }

    @Test
    fun acquire409ThrowsWithHolder() = runBlocking {
        server.enqueue(json(409, """{"code":"lease_held","message":"会话正被其他设备执行","holderDeviceId":"dev_mb14","expiresAt":46}"""))
        try {
            client.acquire("c1")
            fail("应抛 LeaseHeldException")
        } catch (e: LeaseHeldException) {
            assertEquals("dev_mb14", e.holderDeviceId)
            assertEquals(46, e.expiresAt)
        }
    }

    @Test
    fun heartbeat410ThrowsLeaseLost() = runBlocking {
        server.enqueue(json(410, """{"code":"device_revoked","message":"设备会话已被吊销"}"""))
        try {
            client.heartbeat("c1", "lt-1")
            fail("应抛 LeaseLostException")
        } catch (e: LeaseLostException) {
            assertEquals("device_revoked", e.reason)
        }
    }

    @Test
    fun releaseSendsDeleteWithBodyAndIsSilentOnError() = runBlocking {
        server.enqueue(json(500, """{"code":"boom"}""")) // 任何错误静默
        client.release("c1", "lt-1")
        val recorded = server.takeRequest()
        assertEquals("DELETE", recorded.method)
        assertEquals("/v1/leases/c1", recorded.path)
        assertTrue(recorded.body.readUtf8().contains(""""leaseToken":"lt-1""""))
    }

    @Test
    fun heartbeatLoopCallsOnLostAndExits() = runBlocking {
        val fast = LeaseClient(
            ServerHttp(server.url("").toString().trimEnd('/')),
            fixedAuthSession("http://x"),
            heartbeatIntervalMs = 50,
        )
        // 两轮心跳:200 正常 → 410 失效
        server.enqueue(json(200, """{"expiresAt":1}"""))
        server.enqueue(json(410, """{"code":"lease_taken","message":"租约已被其他设备取得"}"""))

        val lost = mutableListOf<LeaseLostException>()
        val job = fast.startHeartbeat(CoroutineScope(SupervisorJob() + Dispatchers.Default), "c1", { "lt-1" }, { lost += it })
        waitFor(timeoutMs = 5_000) { lost.isNotEmpty() }
        job.join()
        assertEquals(1, lost.size)
        assertEquals("lease_taken", lost[0].reason)
        // 循环已退出,不再有新请求
        val countAfterExit = server.requestCount
        Thread.sleep(150)
        assertEquals(countAfterExit, server.requestCount)
    }
}
