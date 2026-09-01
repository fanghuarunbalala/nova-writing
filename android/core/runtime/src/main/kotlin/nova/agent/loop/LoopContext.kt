package nova.agent.loop

import nova.agent.compact.CompactionConfig
import nova.agent.model.LLMessage
import nova.agent.model.SamplingConfig
import nova.agent.model.StoredRun
import nova.agent.provider.ProviderRequest
import nova.agent.provider.ToolSchema
import kotlin.math.ceil

/**
 * 一个 run 的上下文（桌面端 RunContext + LoopContext 合并的对应物）。
 *
 * runs 包含全部历史 run + 本次 run（最后一个）——这样压缩的 keepLast 区天然覆盖当前 run，
 * rewriteAll 重写 journal 时不会丢掉本次 run 已落盘的行。
 */
class LoopContext(
    val runSeq: Int,
    val runs: MutableList<StoredRun>,
    val model: String,
    val sampling: SamplingConfig = SamplingConfig(),
    val maxTokens: Int? = null,
) {
    val currentRun: StoredRun = runs.last()

    fun appendCurrent(messages: List<LLMessage>) {
        currentRun.append(messages)
    }

    fun allMessages(): List<LLMessage> = runs.flatMap { it.messages }

    /** 清扫带 nudge 标记的 system 消息（steer 注入的临时提醒，被下一次请求消费后即清扫）。 */
    fun sweepNudges(): Boolean {
        var swept = false
        runs.forEach { run ->
            val before = run.messages.size
            run.messages.removeAll { it is LLMessage.System && it.nudge }
            if (run.messages.size != before) swept = true
        }
        return swept
    }

    fun toProviderRequest(system: String, tools: List<ToolSchema>): ProviderRequest = ProviderRequest(
        model = model,
        system = system,
        messages = allMessages(),
        tools = tools,
        sampling = sampling,
        maxTokens = maxTokens,
        estimatedInputTokens = totalMessageChars() / 2,
    )

    fun totalMessageChars(): Int = allMessages().sumOf { m ->
        when (m) {
            is LLMessage.User -> m.content.length
            is LLMessage.Assistant -> m.content.length + m.reasoning.length + m.toolCalls.sumOf { it.arguments.length }
            is LLMessage.Tool -> m.content.length
            is LLMessage.System -> m.content.length
        }
    }

    fun estimateTokens(config: CompactionConfig): Int =
        ceil(totalMessageChars() / config.charsPerToken).toInt()

    /** 可压缩区：排除首 keepFirst 与尾 keepLast（尾区含当前 run，永不压缩）。 */
    fun compressibleRuns(config: CompactionConfig): List<StoredRun> {
        if (runs.size <= config.keepFirstRuns + config.keepLastRuns) return emptyList()
        return runs.drop(config.keepFirstRuns).dropLast(config.keepLastRuns)
    }
}
