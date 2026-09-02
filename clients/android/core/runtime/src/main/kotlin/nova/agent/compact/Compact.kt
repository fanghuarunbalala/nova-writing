package nova.agent.compact

import nova.agent.journal.JournalStore
import nova.agent.loop.LoopContext
import nova.agent.model.LLMessage

/**
 * 四级压缩链的 M1 版（桌面端 core/src/runtime/compact 对应物）：
 * T1 结构化骨架化 / T2 逐段摘要折叠 / T3 硬丢弃 + 超窗保险丝（保险丝在 AgentLoop 里）。
 *
 * 与桌面端的简化差异：桌面 AutoCompactPolicy 在单次压缩内 T1→T2→T3 逐级重估；
 * M1 链按「首个实际压缩即短路」执行，force（保险丝）时全链依次执行。
 *
 * 协议硬约束：assistant.toolCalls 与 tool 消息按 id 配对，同留同删（否则下轮 provider 400）。
 */

data class CompactionConfig(
    val contextWindowTokens: Int = 64_000,
    val maxOutputTokens: Int = 4_096,
    /** token 粗估：字符数 / charsPerToken（CJK 粗略 2 字符 ≈ 1 token）。 */
    val charsPerToken: Double = 2.0,
    val keepFirstRuns: Int = 1,
    val keepLastRuns: Int = 3,
    val t1ThresholdRatio: Double = 0.70,
    val t2ReserveTokens: Int = 12_000,
    val t3ThresholdRatio: Double = 0.92,
)

interface CompactPolicy {
    val name: String

    fun shouldCompact(ctx: LoopContext): Boolean

    /** 执行压缩（无视阈值由 force 调用方保证）。返回是否实际改变了内容。 */
    suspend fun compact(ctx: LoopContext): Boolean
}

class CompactPolicyChain(
    private val journal: JournalStore,
    private val config: CompactionConfig,
    policies: List<CompactPolicy>,
) {
    private val ordered = policies.toList()

    /** 阈值触发的常规压缩：首个实际压缩即短路，重写 journal，返回命中的策略名。 */
    suspend fun compactIfNeeded(ctx: LoopContext): String? {
        for (policy in ordered) {
            if (!policy.shouldCompact(ctx)) continue
            if (policy.compact(ctx)) {
                journal.rewriteAll(ctx.runs)
                return policy.name
            }
        }
        return null
    }

    /** 保险丝强制压缩（CONTEXT_LENGTH 后）：无视阈值全链依次执行。返回执行过的策略名。 */
    suspend fun force(ctx: LoopContext): List<String> {
        val applied = mutableListOf<String>()
        for (policy in ordered) {
            if (policy.compact(ctx)) applied.add(policy.name)
        }
        journal.rewriteAll(ctx.runs)
        return applied
    }
}

/** 默认策略链：T1 → T2（注入式摘要器，M1 用确定性占位实现）→ T3。 */
fun defaultPolicies(
    config: CompactionConfig,
    summarizer: suspend (String) -> String = { text ->
        "（M1 确定性摘要占位，原文 ${text.length} 字）" + text.take(200)
    },
): List<CompactPolicy> = listOf(
    T1SkeletonizePolicy(config),
    T2SummarizePolicy(config, summarizer),
    T3DropOldestPolicy(config),
)

/** T1 结构化骨架化：≥70% 窗口时把保留区（首1尾3）之外的 run 消息压成骨架。零模型调用、幂等。 */
class T1SkeletonizePolicy(private val config: CompactionConfig) : CompactPolicy {
    override val name = "t1-skeletonize"

    override fun shouldCompact(ctx: LoopContext): Boolean =
        ctx.estimateTokens(config) >= (config.contextWindowTokens * config.t1ThresholdRatio).toInt()

    override suspend fun compact(ctx: LoopContext): Boolean {
        var changed = false
        ctx.compressibleRuns(config).forEach { run ->
            val skeleton = run.messages.map { m ->
                when (m) {
                    is LLMessage.User ->
                        if (m.content.length > 100) LLMessage.User(m.content.take(100) + "…[T1截断]") else m
                    is LLMessage.Assistant ->
                        if (m.content.isNotEmpty()) m.copy(content = "…[T1骨架化]") else m
                    is LLMessage.Tool ->
                        if (m.content.length > 200) m.copy(content = m.content.take(200) + "…[T1截断]") else m
                    is LLMessage.System -> m
                }
            }
            if (skeleton != run.messages) {
                run.messages.clear()
                run.messages.addAll(skeleton)
                changed = true
            }
        }
        return changed
    }
}

/** T2 逐段摘要折叠：最老非摘要 run → 摘要器 → 替换为 context-summary run。只增不并、永不再摘要。 */
class T2SummarizePolicy(
    private val config: CompactionConfig,
    private val summarizer: suspend (String) -> String,
) : CompactPolicy {
    override val name = "t2-summarize"

    override fun shouldCompact(ctx: LoopContext): Boolean =
        ctx.estimateTokens(config) >= config.contextWindowTokens - config.maxOutputTokens - config.t2ReserveTokens

    override suspend fun compact(ctx: LoopContext): Boolean {
        val candidate = ctx.compressibleRuns(config)
            .filter { !it.summarized && it.messages.isNotEmpty() }
            .minByOrNull { it.runSeq } ?: return false
        val text = candidate.messages.joinToString("\n") { m ->
            when (m) {
                is LLMessage.User -> m.content
                is LLMessage.Assistant -> m.content
                is LLMessage.Tool -> m.content
                is LLMessage.System -> m.content
            }
        }
        val summary = try {
            summarizer(text)
        } catch (e: Exception) {
            // 摘要失败降级为确定性占位（对齐桌面端）
            "（摘要生成失败，折叠占位）" + text.take(200)
        }
        candidate.messages.clear()
        candidate.messages.add(LLMessage.User("<context-summary run=\"${candidate.runSeq}\">\n$summary\n</context-summary>"))
        candidate.summarized = true
        return true
    }
}

/** T3 硬丢弃：≥92% 窗口时从最老开始丢整 run（首 run 最后丢；摘要 run 不丢——丢了就丢信息）。 */
class T3DropOldestPolicy(private val config: CompactionConfig) : CompactPolicy {
    override val name = "t3-drop-oldest"

    override fun shouldCompact(ctx: LoopContext): Boolean =
        ctx.estimateTokens(config) >= (config.contextWindowTokens * config.t3ThresholdRatio).toInt()

    override suspend fun compact(ctx: LoopContext): Boolean {
        var removed = false
        while (shouldCompact(ctx)) {
            val victim = ctx.compressibleRuns(config)
                .filter { !it.summarized }
                .minByOrNull { it.runSeq } ?: break
            ctx.runs.remove(victim)
            removed = true
        }
        return removed
    }
}
