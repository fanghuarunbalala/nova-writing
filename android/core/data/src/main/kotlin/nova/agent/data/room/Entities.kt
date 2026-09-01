package nova.agent.data.room

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * journal 事件表（append-only）：一行 = 一条 JournalLine。
 * 只 INSERT，永不 UPDATE/DELETE；rewriteAll（压缩后全量重写）是唯一重建路径，包 @Transaction。
 * payload 为消息数组的 JSON 串（读侧全量重放，不在 SQL 内查消息字段——MVP 有意取舍）。
 */
@Entity(tableName = "journal_events", indices = [Index("run_seq")])
data class JournalEventRow(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    @ColumnInfo(name = "run_seq") val runSeq: Int,
    /** snapshot | append */
    val kind: String,
    val payload: String,
)

/**
 * 小说域段落表：entity_version 列是乐观锁（桌面端 SqliteNovelStore 同款语义）。
 * 带版本的更新走条件 UPDATE（WHERE entity_version = :base），返回 0 行 = 版本过期。
 */
@Entity(tableName = "paragraphs")
data class ParagraphRow(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "story_unit_id") val storyUnitId: String,
    @ColumnInfo(name = "order_key") val orderKey: Int,
    @ColumnInfo(name = "entity_version") val entityVersion: Int = 1,
    val text: String,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
)
