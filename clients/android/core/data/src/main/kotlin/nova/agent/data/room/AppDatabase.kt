package nova.agent.data.room

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.SQLiteConnection

@Database(
    entities = [JournalEventRow::class, ParagraphRow::class, PendingPushRow::class, JournalCacheRow::class],
    version = 2,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun journalDao(): JournalDao
    abstract fun paragraphDao(): ParagraphDao
    abstract fun pendingPushDao(): PendingPushDao
    abstract fun journalCacheDao(): JournalCacheDao

    companion object {
        const val NAME = "nova.db"

        /** v1→v2（M4 :core:net）：加断线积压表与 SSE 离线只读缓存表。 */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(connection: SQLiteConnection) {
                // KMP SQLite 接口无 execSQL：经 prepare().step() 执行（step 返回 false 即执行完成）
                fun exec(sql: String) = connection.prepare(sql).use { it.step() }
                exec(
                    """CREATE TABLE IF NOT EXISTS `pending_push` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `conversation_id` TEXT NOT NULL,
                        `kind` TEXT NOT NULL,
                        `run_seq` INTEGER NOT NULL,
                        `messages` TEXT NOT NULL,
                        `created_at` INTEGER NOT NULL
                    )"""
                )
                exec("CREATE INDEX IF NOT EXISTS `index_pending_push_conversation_id` ON `pending_push` (`conversation_id`)")
                exec(
                    """CREATE TABLE IF NOT EXISTS `journal_cache` (
                        `conversation_id` TEXT NOT NULL,
                        `seq` INTEGER NOT NULL,
                        `run_seq` INTEGER NOT NULL,
                        `kind` TEXT NOT NULL,
                        `payload` TEXT NOT NULL,
                        `definition_version` TEXT,
                        PRIMARY KEY(`conversation_id`, `seq`)
                    )"""
                )
                exec("CREATE INDEX IF NOT EXISTS `index_journal_cache_conversation_id` ON `journal_cache` (`conversation_id`)")
            }
        }
    }
}
