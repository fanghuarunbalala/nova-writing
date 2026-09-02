package nova.agent.journal

import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.model.ToolCall

/**
 * 崩溃恢复（桌面端 resumePendingRun + findPendingToolIds 对应物）。
 *
 * 恢复链路：journal 重放重建 → findPendingToolCalls 找悬挂调用 → decider 补完 →
 * 上层问用户「从断点继续还是停在这」（M4 的 UI 决策点）。
 */
object Recovery {

    /**
     * 找出缺少 tool 结果的调用（悬挂调用）。
     * 只看最后一个 run：run 自闭环，前面 run 不可能悬挂（每 turn 收口时同批回填）。
     */
    fun findPendingToolCalls(runs: List<StoredRun>): List<ToolCall> {
        val last = runs.lastOrNull() ?: return emptyList()
        val answered = last.messages.filterIsInstance<LLMessage.Tool>().map { it.toolCallId }.toSet()
        return last.messages
            .filterIsInstance<LLMessage.Assistant>()
            .flatMap { it.toolCalls }
            .filter { it.id !in answered }
    }

    /**
     * 补完悬挂调用：为每个 pending 回填一条 tool 消息并落 journal。
     * decider 可定制补完文本（重启续跑时也可选择真的重新执行——M4 恢复向导的选项）。
     * 返回补写的 tool 消息（空列表 = 无悬挂）。
     */
    suspend fun settlePendingRun(
        store: JournalStore,
        runs: MutableList<StoredRun>,
        decider: suspend (ToolCall) -> String = { "会话在重启前中断，该工具调用未执行" },
    ): List<LLMessage.Tool> {
        val pending = findPendingToolCalls(runs)
        if (pending.isEmpty()) return emptyList()
        val last = runs.last()
        val messages = pending.map { LLMessage.Tool(toolCallId = it.id, name = it.name, content = decider(it)) }
        store.appendMessages(last.runSeq, messages)
        last.append(messages)
        return messages
    }
}
