package nova.agent.net.journal

import nova.agent.data.room.PendingPushDao
import nova.agent.data.room.PendingPushRow

/** 积压行（id 为入队序，补推按 id 升序保序）。 */
data class PendingRow(val id: Long, val kind: String, val runSeq: Int, val messagesJson: String)

/** 待推队列超限（10k 行默认）：停止入队防静默丢写，上抛让 run 收 FAILED。 */
class PendingPushOverflowException(val limit: Int) :
    Exception("本地待推队列已满（$limit 行），上推持续失败——请检查网络后重试")

/**
 * 断线积压队列抽象（PRD Android实施-阶段1 FR3）：上推失败入队、恢复后按序补推。
 */
interface PendingPushQueue {
    /** 超过上限抛 PendingPushOverflowException。 */
    suspend fun enqueue(conversationId: String, kind: String, runSeq: Int, messagesJson: String)

    suspend fun drainAll(conversationId: String): List<PendingRow>

    /** 补推成功后删除已推行。 */
    suspend fun removeSent(ids: List<Long>)

    suspend fun count(conversationId: String): Int
}

/** Room pending_push 表实现（:core:data v2）。 */
class RoomPendingPushQueue(
    private val dao: PendingPushDao,
    private val maxRows: Int = 10_000,
    private val clock: () -> Long = System::currentTimeMillis,
) : PendingPushQueue {

    override suspend fun enqueue(conversationId: String, kind: String, runSeq: Int, messagesJson: String) {
        if (dao.count(conversationId) >= maxRows) throw PendingPushOverflowException(maxRows)
        dao.insert(
            PendingPushRow(
                conversationId = conversationId,
                kind = kind,
                runSeq = runSeq,
                messages = messagesJson,
                createdAt = clock(),
            )
        )
    }

    override suspend fun drainAll(conversationId: String): List<PendingRow> =
        dao.listAll(conversationId).map { PendingRow(it.id, it.kind, it.runSeq, it.messages) }

    override suspend fun removeSent(ids: List<Long>) {
        if (ids.isNotEmpty()) dao.deleteByIds(ids)
    }

    override suspend fun count(conversationId: String): Int = dao.count(conversationId)
}
