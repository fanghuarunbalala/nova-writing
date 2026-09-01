package nova.agent.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * journal 行协议（桌面端 FileConversationJournalService 的增量行协议对应物）：
 * - Snapshot：run「开号」一行，携带 run 的首批消息（user 输入）；
 * - Append：run 内每次消息追加分批一行。
 * JSONL 实现一行一条；Room 实现一列一条（payload 均为 JSON）。
 * 只追加、不修改；压缩后的全量重写是唯一重建路径（rewriteAll）。
 */
@Serializable
sealed interface JournalLine {
    val seq: Long

    @Serializable
    @SerialName("snapshot")
    data class Snapshot(
        override val seq: Long,
        val runSeq: Int,
        val messages: List<LLMessage>,
    ) : JournalLine

    @Serializable
    @SerialName("append")
    data class Append(
        override val seq: Long,
        val runSeq: Int,
        val messages: List<LLMessage>,
    ) : JournalLine
}

/**
 * 重放出来的一个 run。summarized：T2 摘要折叠后置 true，只增不并、永不再摘要。
 */
data class StoredRun(
    val runSeq: Int,
    val messages: MutableList<LLMessage> = mutableListOf(),
    var summarized: Boolean = false,
) {
    /** 重放后追加（同一 run 的 append 行归并进同一 StoredRun）。 */
    fun append(messages: List<LLMessage>) {
        this.messages.addAll(messages)
    }
}
