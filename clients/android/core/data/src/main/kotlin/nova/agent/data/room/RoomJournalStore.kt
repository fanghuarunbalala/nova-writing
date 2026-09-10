package nova.agent.data.room

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import nova.agent.journal.JournalStore
import nova.agent.model.JournalLine
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun

/**
 * JournalStore 的 Room 实现——与 JsonlJournalStore 同一契约、同一行协议
 * （snapshot 开号 / append 追加 / rewriteAll 全量重写 / readAll 重放）。
 *
 * Android 设备上用框架 SQLite 驱动；JVM 单测用 BundledSQLiteDriver 内存库。
 * 单写者串行：Mutex（与 JSONL 实现一致）。
 */
class RoomJournalStore(
    private val db: AppDatabase,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
) : JournalStore {

    private val mutex = Mutex()
    private val messageListSerializer = ListSerializer(LLMessage.serializer())
    private var lastSeq: Long = 0

    override suspend fun open() = mutex.withLock {
        lastSeq = db.journalDao().readAllRows().lastOrNull()?.seq ?: 0L
    }

    override suspend fun appendSnapshot(
        runSeq: Int,
        messages: List<LLMessage>,
        definitionVersion: String?,
    ): JournalLine.Snapshot =
        mutex.withLock {
            val seq = db.journalDao().insert(
                JournalEventRow(
                    runSeq = runSeq,
                    kind = KIND_SNAPSHOT,
                    payload = encode(messages),
                    // definitionVersion 随 payload 行落库（读侧重放时从行 JSON 还原，见 readAll）
                    extra = definitionVersion,
                )
            )
            lastSeq = maxOf(lastSeq, seq)
            JournalLine.Snapshot(seq, runSeq, messages, definitionVersion)
        }

    override suspend fun appendMessages(runSeq: Int, messages: List<LLMessage>): JournalLine.Append =
        mutex.withLock {
            val seq = db.journalDao().insert(
                JournalEventRow(runSeq = runSeq, kind = KIND_APPEND, payload = encode(messages))
            )
            lastSeq = maxOf(lastSeq, seq)
            JournalLine.Append(seq, runSeq, messages)
        }

    override suspend fun readAll(): List<StoredRun> {
        val runs = LinkedHashMap<Int, StoredRun>()
        db.journalDao().readAllRows().forEach { row ->
            val messages = decode(row.payload)
            when (row.kind) {
                KIND_SNAPSHOT -> runs[row.runSeq] = StoredRun(row.runSeq).apply {
                    append(messages)
                    definitionVersion = row.extra
                }
                else -> runs.getOrPut(row.runSeq) { StoredRun(row.runSeq) }.append(messages)
            }
        }
        // 摘要标记跨重启幂等：内容级 <context-summary> 标记恢复 summarized 状态
        runs.values.forEach { it.detectSummaryMarker() }
        return runs.values.toList()
    }

    override suspend fun rewriteAll(runs: List<StoredRun>) = mutex.withLock {
        val rows = runs.map { JournalEventRow(runSeq = it.runSeq, kind = KIND_SNAPSHOT, payload = encode(it.messages)) }
        db.journalDao().rewriteAll(rows)
        lastSeq = db.journalDao().readAllRows().lastOrNull()?.seq ?: 0L
    }

    override fun close() {
        // db 生命周期由构造方（M4 的 :app / DI 容器）管理，这里不关闭
    }

    private fun encode(messages: List<LLMessage>): String = json.encodeToString(messageListSerializer, messages)

    private fun decode(payload: String): List<LLMessage> = json.decodeFromString(messageListSerializer, payload)

    companion object {
        const val KIND_SNAPSHOT = "snapshot"
        const val KIND_APPEND = "append"

        /** JVM 测试用内存库（BundledSQLiteDriver）。 */
        fun inMemory(): Pair<AppDatabase, RoomJournalStore> {
            val db = Room.inMemoryDatabaseBuilder<AppDatabase>()
                .setDriver(BundledSQLiteDriver())
                .setQueryCoroutineContext(Dispatchers.IO)
                .build()
            return db to RoomJournalStore(db)
        }
    }
}

/** 摘要 run 的内容级标记检测（桌面端跨重启幂等方案）：单条 user 消息以 <context-summary 开头。 */
fun StoredRun.detectSummaryMarker() {
    summarized = messages.size == 1 &&
        (messages[0] as? LLMessage.User)?.content?.startsWith("<context-summary") == true
}
