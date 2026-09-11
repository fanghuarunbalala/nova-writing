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
    /** 附带元数据（snapshot 行存 definitionVersion）。 */
    val extra: String? = null,
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

/**
 * 断线积压表（M4 :core:net）：HttpJournalStore 上推失败时按 id 自增序入队，
 * 恢复在线后按 id 序逐条补推、全部成功才删行（PRD Android实施-阶段1 FR3）。
 * 10k 行上限由 PendingPushQueue 控制并抛 PendingPushOverflowException。
 */
@Entity(tableName = "pending_push", indices = [Index("conversation_id")])
data class PendingPushRow(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "conversation_id") val conversationId: String,
    /** snapshot | append */
    val kind: String,
    @ColumnInfo(name = "run_seq") val runSeq: Int,
    /** messages 数组 JSON 串（与 journal_events.payload 同格式） */
    val messages: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

/**
 * SSE journal 事件离线只读缓存（M4 :core:net）：SseBridge 收到的他端 journal 事件落库，
 * 离线也能翻看会话进度（PRD Android实施-阶段1 FR7）；journal_rewritten 时整会话清空重灌。
 */
@Entity(tableName = "journal_cache", primaryKeys = ["conversation_id", "seq"], indices = [Index("conversation_id")])
data class JournalCacheRow(
    @ColumnInfo(name = "conversation_id") val conversationId: String,
    /** server 账本全局行号（复合主键一半，天然去重幂等） */
    val seq: Long,
    @ColumnInfo(name = "run_seq") val runSeq: Int,
    /** snapshot | append | domain-mutation | memory-write …原样保存 */
    val kind: String,
    val payload: String,
    @ColumnInfo(name = "definition_version") val definitionVersion: String? = null,
)
