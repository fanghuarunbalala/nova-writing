package nova.agent.data

import kotlinx.coroutines.test.runTest
import nova.agent.data.room.AppDatabase
import nova.agent.data.room.JournalEventRow
import nova.agent.data.room.ParagraphRow
import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.Dispatchers
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** entity_version 乐观锁：条件 UPDATE 不匹配返回 0 行（桌面端 checkRevision 同款语义）。 */
class ParagraphOptimisticLockTest {

    private lateinit var db: AppDatabase

    private fun setup(): AppDatabase {
        db = Room.inMemoryDatabaseBuilder<AppDatabase>()
            .setDriver(BundledSQLiteDriver())
            .setQueryCoroutineContext(Dispatchers.IO)
            .build()
        return db
    }

    @AfterTest
    fun tearDown() {
        if (this::db.isInitialized) db.close()
    }

    @Test
    fun conditionalUpdateRejectsStaleRevision() = runTest {
        val db = setup()
        val dao = db.paragraphDao()
        dao.insert(ParagraphRow("p-1", "su-12", 1, entityVersion = 1, text = "初稿", updatedAt = 0))

        // 版本匹配 → 更新成功，版本 +1
        val affected = dao.updateWithRevision("p-1", 1, "二稿", baseRevision = 1, now = 100)
        assertEquals(1, affected)
        assertEquals(2, dao.byId("p-1")!!.entityVersion)
        assertEquals("二稿", dao.byId("p-1")!!.text)

        // 基于过期版本 v1 再改 → 0 行受影响（AI 基于过期上下文的写入被拒，需重读自纠）
        val stale = dao.updateWithRevision("p-1", 1, "过期的三稿", baseRevision = 1, now = 200)
        assertEquals(0, stale)
        assertEquals("二稿", dao.byId("p-1")!!.text)
        assertEquals(2, dao.byId("p-1")!!.entityVersion)
    }

    @Test
    fun conditionalDeleteAndQuery() = runTest {
        val db = setup()
        val dao = db.paragraphDao()
        dao.insert(ParagraphRow("p-1", "su-12", 1, 1, "甲", 0))
        dao.insert(ParagraphRow("p-2", "su-12", 2, 1, "乙", 0))
        dao.insert(ParagraphRow("p-3", "su-13", 1, 1, "丙", 0))

        assertEquals(listOf("p-1", "p-2"), dao.byStoryUnit("su-12").map { it.id })
        assertEquals(0, dao.deleteWithRevision("p-1", baseRevision = 99))
        assertEquals(1, dao.deleteWithRevision("p-1", baseRevision = 1))
        assertNull(dao.byId("p-1"))
        assertEquals(2, dao.all().size)
    }

    @Test
    fun journalRowAutoIncrementMonotonic() = runTest {
        val db = setup()
        val dao = db.journalDao()
        val s1 = dao.insert(JournalEventRow(runSeq = 1, kind = "snapshot", payload = "[]"))
        val s2 = dao.insert(JournalEventRow(runSeq = 1, kind = "append", payload = "[]"))
        assertTrue(s2 > s1)
        assertEquals(2, dao.readAllRows().size)
        dao.rewriteAll(listOf(JournalEventRow(runSeq = 1, kind = "snapshot", payload = "[]")))
        assertEquals(1, dao.readAllRows().size)
    }
}
