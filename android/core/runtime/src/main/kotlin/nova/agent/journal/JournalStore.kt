package nova.agent.journal

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import nova.agent.model.JournalLine
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * 会话持久化抽象（桌面端 FileConversationJournalService 对应物）。
 * 双实现同契约：JsonlJournalStore（JVM 测试/桌面调试）与 RoomJournalStore（:core:data，M2）。
 *
 * 行协议：Snapshot（run 开号）+ Append（消息追加），只追加不修改；
 * 压缩后的全量重写 rewriteAll 是唯一重建路径。
 */
interface JournalStore {
    /** 扫描既有文件恢复 lastSeq（容忍末尾断行）。幂等。 */
    suspend fun open()

    suspend fun appendSnapshot(runSeq: Int, messages: List<LLMessage>): JournalLine.Snapshot

    suspend fun appendMessages(runSeq: Int, messages: List<LLMessage>): JournalLine.Append

    /** 重放全部 run（snapshot 开号 + append 逐条归并）。 */
    suspend fun readAll(): List<StoredRun>

    /** 压缩后全量重写：每个 run 一行 Snapshot，原子替换。 */
    suspend fun rewriteAll(runs: List<StoredRun>)

    fun close() {}
}

/**
 * JSONL 文件实现：一行一条 JournalLine 的 JSON。
 * 单写者串行：Mutex（对齐桌面端 writeChain Promise 链）；断行容忍：仅丢弃解析失败的行并告警。
 */
class JsonlJournalStore(
    private val path: Path,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
    /** 文件 IO 调度器可注入：单测注入 TestDispatcher，虚拟时钟下行为完全确定。 */
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : JournalStore {

    private val mutex = Mutex()
    private var lastSeq: Long = 0

    override suspend fun open() = mutex.withLock {
        lastSeq = 0
        if (!Files.exists(path)) {
            Files.createDirectories(path.toAbsolutePath().parent)
            return@withLock
        }
        Files.readAllLines(path).forEach { line ->
            if (line.isBlank()) return@forEach
            decode(line)?.let { lastSeq = maxOf(lastSeq, it.seq) }
        }
    }

    override suspend fun appendSnapshot(runSeq: Int, messages: List<LLMessage>): JournalLine.Snapshot =
        mutex.withLock {
            val line = JournalLine.Snapshot(seq = ++lastSeq, runSeq = runSeq, messages = messages)
            writeLine(line)
            line
        }

    override suspend fun appendMessages(runSeq: Int, messages: List<LLMessage>): JournalLine.Append =
        mutex.withLock {
            val line = JournalLine.Append(seq = ++lastSeq, runSeq = runSeq, messages = messages)
            writeLine(line)
            line
        }

    override suspend fun readAll(): List<StoredRun> = withContext(io) {
        if (!Files.exists(path)) return@withContext emptyList()
        val runs = LinkedHashMap<Int, StoredRun>()
        Files.readAllLines(path).forEachIndexed { index, line ->
            if (line.isBlank()) return@forEachIndexed
            val decoded = decode(line) ?: run {
                if (index == Files.readAllLines(path).size - 1) {
                    // 末尾断行：写到一半崩溃的残留，丢弃（对齐桌面端容忍策略）
                } else {
                    System.err.println("journal 第 ${index + 1} 行解析失败，跳过: ${line.take(80)}")
                }
                return@forEachIndexed
            }
            when (decoded) {
                is JournalLine.Snapshot -> runs[decoded.runSeq] = StoredRun(decoded.runSeq).apply { append(decoded.messages) }
                is JournalLine.Append -> runs.getOrPut(decoded.runSeq) { StoredRun(decoded.runSeq) }
                    .append(decoded.messages)
            }
        }
        // 摘要标记跨重启幂等（桌面端内容级标记方案）：单条 user 消息以 <context-summary 开头
        runs.values.forEach { r ->
            r.summarized = r.messages.size == 1 &&
                (r.messages[0] as? LLMessage.User)?.content?.startsWith("<context-summary") == true
        }
        runs.values.toList()
    }

    override suspend fun rewriteAll(runs: List<StoredRun>) {
        mutex.withLock {
        val tmp = path.resolveSibling(path.fileName.toString() + ".tmp")
        val sb = StringBuilder()
        var seq = 0L
        runs.forEach { run ->
            seq++
            sb.append(json.encodeToString(JournalLine.serializer(), JournalLine.Snapshot(seq, run.runSeq, run.messages)))
                .append('\n')
        }
        lastSeq = seq
        withContext(io) {
            Files.createDirectories(path.toAbsolutePath().parent)
            Files.writeString(tmp, sb.toString())
            Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }
        }
    }

    private suspend fun writeLine(line: JournalLine) = withContext(io) {
        Files.createDirectories(path.toAbsolutePath().parent)
        Files.writeString(path, json.encodeToString(JournalLine.serializer(), line) + "\n", java.nio.file.StandardOpenOption.APPEND, java.nio.file.StandardOpenOption.CREATE)
    }

    private fun decode(line: String): JournalLine? = try {
        json.decodeFromString(JournalLine.serializer(), line)
    } catch (_: Exception) {
        null
    }
}
