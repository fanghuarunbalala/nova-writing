package nova.agent.data.room

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface JournalDao {
    @Insert
    suspend fun insert(row: JournalEventRow): Long

    @Query("SELECT * FROM journal_events ORDER BY seq")
    suspend fun readAllRows(): List<JournalEventRow>

    @Query("DELETE FROM journal_events")
    suspend fun clear()

    /** 压缩后的全量重写：清表 + 逐条重插，单事务原子（对应桌面端 writeRuns 覆盖重写）。 */
    @Transaction
    suspend fun rewriteAll(rows: List<JournalEventRow>) {
        clear()
        rows.forEach { insert(it) }
    }
}

@Dao
interface ParagraphDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(row: ParagraphRow)

    @Query("SELECT * FROM paragraphs WHERE story_unit_id = :storyUnitId ORDER BY order_key")
    suspend fun byStoryUnit(storyUnitId: String): List<ParagraphRow>

    @Query("SELECT * FROM paragraphs ORDER BY story_unit_id, order_key")
    suspend fun all(): List<ParagraphRow>

    @Query("SELECT * FROM paragraphs WHERE id = :id")
    suspend fun byId(id: String): ParagraphRow?

    /** 乐观锁更新：仅当版本匹配才生效，返回受影响行数（0 = 过期，需重读）。 */
    @Query(
        """UPDATE paragraphs SET
            text = :text, order_key = :orderKey,
            entity_version = entity_version + 1, updated_at = :now
        WHERE id = :id AND entity_version = :baseRevision"""
    )
    suspend fun updateWithRevision(id: String, orderKey: Int, text: String, baseRevision: Int, now: Long): Int

    @Query("DELETE FROM paragraphs WHERE id = :id AND entity_version = :baseRevision")
    suspend fun deleteWithRevision(id: String, baseRevision: Int): Int
}
