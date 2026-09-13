package nova.agent.app.data

import nova.agent.model.ToolCall

/**
 * 《长夜余烬》演示脚本：台词/卡片逐字对齐 docs/design/android-app-demo.html（阶段2补 FR1）。
 * 会话 = conv_2 · run #47 · journal seq 213 · 第 2 章「追逃段」修订 · 第 3 轮。
 * 时间轴节奏 = runtime 契约（delta 32ms 累计文本，demo 的 60ms/2 字节奏不复制）。
 */
data class DemoScript(
    val conversationId: String = "conv_2",
    /** 顶栏第二行（会话上下文） */
    val sessionSubtitle: String = "第 2 章 · 追逃段修订 · 第 3 轮",
    /** 会话信息（⋯菜单副行） */
    val sessionMeta: String = "conv_2 · 需审核模式 · seq 213",
    val userPrompt: String = "沈砚在雾夜里认出了那枚火漆印——把他袖口的轮廓写清楚一点，顺便推进到渡口对峙。",
    /** 打字机草稿 = demo DRAFT_TEXT（L2153，114 字；「812 字」是审批卡/阅读视图的叙事元数据） */
    val draftText: String = DRAFT,
    /** 收口正文 = demo 阅读视图草稿三段（P1/P2/P3） */
    val finalText: String = FINAL,
    val reasoning: String = REASONING,
    val deltaTickMs: Long = 32,
    val deltaTicks: Int = 57,
    val thinkingMs: Long = 2200,
    /** 审批批次（demo：一次工具调用一批） */
    val approvalRequestId: String = "approval:conv_2:47:b2",
    val approvalCalls: List<ToolCall> = APPROVAL_CALLS,
    val history: List<DemoHistoryRun> = HISTORY,
) {
    /** 历史轮次里的单条工具行 */
    data class DemoTool(val name: String, val summary: String)

    /**
     * 历史轮次。run=1 → 第 2 轮（完整收口）；run=2 → 第 3 轮（demo 首屏：用户消息 +
     * Read/MemorySearch 已完成 + NovelWrite 进行中 + 草稿已流出，未收口）。
     */
    data class DemoHistoryRun(
        val userText: String,
        val assistantText: String? = null,
        val tools: List<DemoTool> = emptyList(),
        /** 进行中的工具行（RUN 态无响应；下次交互 run 开始时以「提请审批」收口） */
        val runningTool: DemoTool? = null,
        /** 正文实体标注（demo entChip）：实体名 → 内容 sheet tab（2=人物 3=地点） */
        val entities: List<Pair<String, Int>> = emptyList(),
    )

    /** runSeq → 轮次分隔线文案；null = 不插（demo run #47 是第 3 轮的接续） */
    fun roundLabelFor(runSeq: Int): String? = when (runSeq) {
        1 -> "第 2 轮 · 沈砚档案核对"
        2 -> "第 3 轮 · 追逃段修订"
        3 -> null
        else -> "第 $runSeq 轮 · 续写"
    }

    companion object {
        /** demo DRAFT_TEXT（L2153）逐字 */
        val DRAFT =
            "雾更浓了。沈砚把橹往水里一压，船头无声地转向上游的旧矶。火漆印贴着他的腕骨，隔着旧棉布，" +
                "竟还有一点温度——像谁刚从火漆上取下来，又像它自己记着三年前那场火。对岸的灯笼次第灭下去，" +
                "只剩渡口最东头那一盏，晃着，把他的影子钉在船板上。"

        /** 阅读视图草稿（L2700-2708）：P1 + P2 + P3(=DRAFT) */
        val FINAL = """
            「上船。」那声音说。沈砚没有回头，只把橹又压深了一寸。

            对岸的灯笼次第灭下去，只剩渡口最东头那一盏，晃着，把他的影子钉在船板上。他忽然放慢了橹。水面下有第二道桨声，压得极低，跟了他至少半里。

            $DRAFT
        """.trimIndent()

        val REASONING =
            "追逃段收在「对峙的第一拍」：用雾、第二道桨声与火漆印的温度推紧迫感；" +
                "袖口轮廓写实、渡口对峙留白——「贴身藏印」与第 1 卷 7 处伏笔的呼应埋进动作里。"

        /** 实体胶囊静态标注：助手正文 id → (实体名, 内容 sheet tab) */
        val ENTITY_MARKS: Map<String, List<Pair<String, Int>>> = mapOf(
            "a-1" to listOf("沈砚" to 2, "北桥渡口" to 3),
        )

        // ---- 审批三卡（demo defaultCards L2247-2269 逐字；键值行 + stale 版本过期） ----

        private const val EDIT_ARGS =
            """{"op":"edit","title":"沈砚 · 角色档案（v2 → v3）","current":"北桥渡口的老船工，五十出头，话少。三十年来只在雾夜里摆渡一条船，从不载回头客。","change":"现状与简介两处更新——袖口轮廓写实","changeRows":[{"k":"现状","v":"袖口旧铜扣换成半枚火漆印——与漕帮失窃案对上"},{"k":"简介","v":"追加：认印不认人，认人不认账。"}],"stale":["v2","v3"],"origin":"桌面端 · dev_mb14"}"""

        private const val WRITE_ARGS =
            """{"op":"add","title":"正文 · 第 2 章 · 追逃段（草稿 812 字）","current":"（此章该段尚无正文）","change":"第 2 章 · 追逃段 · 尾部新增草稿","changeRows":[{"k":"位置","v":"第 2 章 · 追逃段 · 尾部"},{"k":"内容","v":"沈砚压橹转向上游旧矶，火漆印在雾里一闪——渡口对峙的第一拍。"},{"k":"去向","v":"草稿 · 批准后转入正式稿待作者校对"}],"origin":"桌面端 · dev_mb14"}"""

        private const val DELETE_ARGS =
            """{"op":"delete","title":"地点 · 废弃渡口碑（v1）","current":"城南三里的旧渡口碑，字迹漫漶，无人照看。","change":"与「北桥渡口」重复建档，删除旧卡","currentRows":[{"k":"名称","v":"废弃渡口碑"},{"k":"现状","v":"字迹漫漶，无人照看"},{"k":"关联","v":"2 个大纲单元引用此地点"}],"changeRows":[{"k":"理由","v":"与「北桥渡口」重复建档"},{"k":"影响","v":"2 处大纲关联将悬空，需在下一轮修复"}],"origin":"桌面端 · dev_mb14"}"""

        val APPROVAL_CALLS = listOf(
            ToolCall(id = "call-edit-profile", name = "NovelEdit", arguments = EDIT_ARGS),
            ToolCall(id = "call-write-draft", name = "NovelWrite", arguments = WRITE_ARGS),
            ToolCall(id = "call-delete-stele", name = "NovelDelete", arguments = DELETE_ARGS),
        )

        /** 会话历史（demo chatBody L1155-1207 逐字） */
        val HISTORY = listOf(
            DemoHistoryRun(
                userText = "把沈砚的设定再顺一遍——袖口那枚火漆印和漕帮失窃案是什么关系？",
                assistantText = "火漆印首次出现在第 1 卷第 7 章（漕帮账房密室失窃当夜）。三年来沈砚从未离开北桥渡口——" +
                    "「贴身藏印」与「不知情转交」两条解释线里，前者与现有 12 处伏笔兼容性更好。" +
                    "建议本轮先把袖口轮廓写实，渡口对峙留到下一轮。",
                tools = listOf(DemoTool("NovelRead", "沈砚 · 档案 v2")),
                entities = listOf("沈砚" to 2, "北桥渡口" to 3),
            ),
            DemoHistoryRun(
                userText = "沈砚在雾夜里认出了那枚火漆印——把他袖口的轮廓写清楚一点，顺便推进到渡口对峙。",
                tools = listOf(
                    DemoTool("Read", "NOVEL.md"),
                    DemoTool("MemorySearch", "袖口 火漆印"),
                ),
                runningTool = DemoTool("NovelWrite", "第 2 章 · 追逃段 · 提请审批"),
            ),
        )
    }
}

/**
 * 翻页历史段（loadOlder）。段 0 = demo 逐字（L2496-2505「第 1 轮 · 开卷核对」整轮）；
 * 段 1 = 更早的模板化归档（7 run，凑 demo「剩 8 轮」的口径）。
 */
internal fun olderSegment(segIndex: Int): List<ChatItem> {
    if (segIndex == 0) {
        return listOf(
            ChatItem.RoundLabel("h-0-round", "第 1 轮 · 开卷核对"),
            ChatItem.UserMsg("h-0-u", "第 1 章夜航定稿后，把沈砚的档案按新设定顺一遍。"),
            ChatItem.AssistantMsg("h-0-a", "已核对：档案 v1 → v2，补入「三十年来只在雾夜里摆渡一条船」；与第 1 卷 7 处伏笔登记一致。"),
        )
    }
    return buildList {
        repeat(7) { i ->
            add(ChatItem.UserMsg("h-1-$i-u", "继续第 1 章第 ${i + 1} 段，保持夜航的调子。"))
            add(ChatItem.AssistantMsg("h-1-$i-a", "（历史归档 · 开卷片段 ${i + 1}）已按既定大纲推进：场景两景一转，段末留一个未闭合的动作钩子。"))
        }
    }
}
