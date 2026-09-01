package nova.agent.data.room

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [JournalEventRow::class, ParagraphRow::class],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun journalDao(): JournalDao
    abstract fun paragraphDao(): ParagraphDao

    companion object {
        const val NAME = "nova.db"
    }
}
