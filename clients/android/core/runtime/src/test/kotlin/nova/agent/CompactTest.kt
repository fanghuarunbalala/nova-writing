package nova.agent

import kotlinx.coroutines.test.runTest
import nova.agent.compact.CompactionConfig
import nova.agent.compact.CompactPolicyChain
import nova.agent.compact.T1SkeletonizePolicy
import nova.agent.compact.T2SummarizePolicy
import nova.agent.compact.T3DropOldestPolicy
import nova.agent.compact.defaultPolicies
import nova.agent.journal.JsonlJournalStore
import nova.agent.loop.LoopContext
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.model.ToolCall
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class CompactTest {

    private fun bigRun(runSeq: Int, chars: Int, withToolCall: Boolean = false): StoredRun {
        val run = StoredRun(runSeq)
        run.append(listOf(LLMessage.User("第${runSeq}章指令" + "背景".repeat(chars))))
        if (withToolCall) {
            run.append(
                listOf(
                    LLMessage.Assistant(
                        "我来改".repeat(10),
                        toolCalls = listOf(ToolCall("c$runSeq", "novel_write_paragraph", "{}")),
                        finishReason = FinishReason.TOOL_CALL,
                    ),
                    LLMessage.Tool("c$runSeq", "novel_write_paragraph", "已写入段落（v1）".repeat(40)),
                    LLMessage.Assistant("完成", finishReason = FinishReason.STOP),
                )
            )
        } else {
            run.append(listOf(LLMessage.Assistant("第${runSeq}章正文".repeat(chars / 10))))
        }
        return run
    }

    private fun context(vararg runs: StoredRun): LoopContext =
        LoopContext(runSeq = runs.last().runSeq, runs = runs.toMutableList(), model = "m")

    @Test
    fun t1SkeletonizesMiddleZoneKeepsFirstAndLast() = runTest {
        // 窗口 3000 token（6000 字符），T1 阈值 70% = 4200 字符
        val cfg = CompactionConfig(contextWindowTokens = 3000, charsPerToken = 2.0)
        val runs = listOf(
            bigRun(1, 50),
            bigRun(2, 2000, withToolCall = true), // 中间区
            bigRun(3, 2000, withToolCall = true), // 中间区
            bigRun(4, 2000),
            bigRun(5, 50),
            bigRun(6, 50),
        )
        val ctx = context(*runs.toTypedArray())
        val policy = T1SkeletonizePolicy(cfg)

        assertTrue(policy.shouldCompact(ctx))
        assertTrue(policy.compact(ctx))

        // 首1尾3之外的 run（2、3）被骨架化，首尾原文保留
        assertTrue((runs[0].messages[0] as LLMessage.User).content.contains("第1章指令背景"))
        assertTrue((runs[5].messages[0] as LLMessage.User).content.contains("第6章指令背景"))
        val skeletonUser = (runs[1].messages[0] as LLMessage.User).content
        assertTrue(skeletonUser.contains("[T1截断]") && skeletonUser.length < 120)
        // 协议约束：assistant 的 toolCalls 保留（与 tool 消息配对），内容骨架化
        val skeletonAssistant = assertIs<LLMessage.Assistant>(runs[1].messages[1])
        assertEquals(1, skeletonAssistant.toolCalls.size)
        assertEquals("…[T1骨架化]", skeletonAssistant.content)
        val skeletonTool = assertIs<LLMessage.Tool>(runs[1].messages[2])
        assertTrue(skeletonTool.content.contains("[T1截断]"))
        // 幂等：再压一次无变化
        assertTrue(!policy.compact(ctx))
    }

    @Test
    fun t2SummarizeFoldsOldestCompressibleRun() = runTest {
        val cfg = CompactionConfig(contextWindowTokens = 3000, charsPerToken = 2.0)
        var summarized = ""
        // 6 个 run：可压缩区 = run2、run3（首1尾3之外）
        val runs = listOf(
            bigRun(1, 1500), bigRun(2, 1500), bigRun(3, 1500), bigRun(4, 200), bigRun(5, 200), bigRun(6, 200),
        )
        val ctx = context(*runs.toTypedArray())
        val policy = T2SummarizePolicy(cfg, summarizer = { text -> summarized = text; "摘要：${text.take(10)}" })

        assertTrue(policy.shouldCompact(ctx))
        assertTrue(policy.compact(ctx))

        // 可压缩区里最老的非摘要 run（run 2）折叠成 context-summary，且标记不再二次摘要
        assertTrue(runs[1].summarized)
        assertEquals(1, runs[1].messages.size)
        val summaryMsg = assertIs<LLMessage.User>(runs[1].messages[0])
        assertTrue(summaryMsg.content.startsWith("<context-summary"))
        assertTrue(summaryMsg.content.contains("摘要："))
        assertTrue(summarized.contains("第2章"))
        // 首区 run1 原样保留（keepFirst 不参与折叠）
        assertTrue(!runs[0].summarized)

        // 摘要 run 永不再摘要：再次压缩轮到 run 3
        val policy2 = T2SummarizePolicy(cfg, summarizer = { "第二轮" })
        assertTrue(policy2.compact(ctx))
        assertTrue(runs[2].summarized)
        assertEquals(1, runs[1].messages.size)
    }

    @Test
    fun t3DropsOldestWhenHardLine() = runTest {
        val cfg = CompactionConfig(contextWindowTokens = 3000, charsPerToken = 2.0) // T3 线 92% = 5520 字符
        val runs = listOf(
            bigRun(1, 100).also { it.summarized = true }, // 摘要 run 不丢
            bigRun(2, 2000), bigRun(3, 2000), bigRun(4, 200), bigRun(5, 200), bigRun(6, 200),
        )
        val ctx = context(*runs.toTypedArray())
        val policy = T3DropOldestPolicy(cfg)

        assertTrue(policy.shouldCompact(ctx))
        assertTrue(policy.compact(ctx))

        // run 2、run 3 被丢，首 run（已摘要）与尾 3 run 保留
        assertEquals(listOf(1, 4, 5, 6), ctx.runs.map { it.runSeq })
    }

    @Test
    fun chainCompactIfNeededShortCircuitsAndRewritesJournal() = runTest {
        val dir = Files.createTempDirectory("nova-j")
        val journal = JsonlJournalStore(dir.resolve("journal.jsonl"))
        journal.open()
        journal.appendSnapshot(1, listOf(LLMessage.User("a")))
        journal.appendSnapshot(2, listOf(LLMessage.User("b")))
        journal.appendSnapshot(3, listOf(LLMessage.User("c")))

        val cfg = CompactionConfig(contextWindowTokens = 3000, charsPerToken = 2.0)
        val runs = listOf(
            bigRun(1, 2000, withToolCall = true),
            bigRun(2, 2000),
            bigRun(3, 2000),
            bigRun(4, 200),
            bigRun(5, 200),
            bigRun(6, 200),
        )
        val ctx = LoopContext(6, runs.toMutableList(), "m")
        val chain = CompactPolicyChain(journal, cfg, defaultPolicies(cfg))

        val applied = chain.compactIfNeeded(ctx)
        // 首个实际压缩即短路：T1 命中
        assertEquals("t1-skeletonize", applied)
        val replayed = journal.readAll()
        assertEquals(6, replayed.size) // 全量重写：所有 run 都在
        assertTrue(
            (replayed[1].messages[0] as LLMessage.User).content.contains("[T1截断]"),
        )
    }
}
