package nova.agent.app.data

import nova.agent.model.ToolCall

/**
 * 《长夜余烬》演示脚本：replicates android-app-demo.html 的状态重放时间轴（PRD FR12）。
 * 文本/卡片为演示原创内容；时间轴节奏 = runtime 契约（delta 32ms 累计）。
 */
data class DemoScript(
    val conversationId: String = "conv-0192f-demo-0007",
    val userPrompt: String = "续写第12章追逃段——把紧迫感推到极限，收在悬置点。",
    val draftText: String = DRAFT,
    val finalText: String = FINAL,
    val reasoning: String = REASONING,
    val deltaTickMs: Long = 32,
    val deltaTicks: Int = 175,
    val thinkingMs: Long = 2200,
    val approvalCalls: List<ToolCall> = APPROVAL_CALLS,
    val history: List<DemoHistoryRun> = HISTORY,
) {
    data class DemoHistoryRun(
        val userText: String,
        val assistantText: String,
        val toolName: String? = null,
        val toolSummary: String? = null,
    )

    companion object {
        val DRAFT = """扶栏的凉意隔着手套渗进掌心。灰烬没有回头，她数着脚下旋转楼梯的圈数——第七级台阶总有一声空响，那是殿主为夜巡设下的界线。身后，蟒皮靴声三短一停，再三短。猎队，而且是已经咬住目标的猎队。
她把铜管剩下的半截塞进衣领，指尖擦过枣核的温度——那是祖母留下的最后一件东西。负二层往下，穿过晾房，旱年的老排水渠就在铁栅外面。
墙龛里的灯油见了底，火苗缩成绿豆大小。就在这点明灭里，她终于看清了刻在地砖上的那行小字：
「余烬，三十二。」
她的呼吸停了半拍。殿主数到三十二的那一夜，正是她出生的那一夜。"""

        val FINAL = DRAFT + """
铁栅的锁是新的，锁芯却咔哒一声弹开——有人在等她来。灰烬把这一发现压进喉咙里，像吞下一枚烧红的炭。排水渠里的风带着铁锈和旧水的味道，她侧身挤进渠口，肩胛擦掉一片锈皮。
身后的靴声在晾房门口停了。三短一停的节奏换了：两长。收网。
她加快脚步。数到第一百步的时候，头顶忽然亮起一盏灯。灯下站着的人她认得——白日里管香火的哑仆。哑仆没有喊，只是抬手往左边指了指，然后吹熄了灯。
黑暗重新合拢的瞬间，灰烬听见了那声音：很轻，像灰落在灰上。
「往东，第三道闸。」
是祖母的声音。
她攥紧枣核，往东跑去。"""

        val REASONING =
            "追逃段要的是节奏而非场面：用声音（靴声三短一停→两长）标记猎队动作，用触觉（枣核温度）锚定情感；" +
                "铜管伏笔回收为开锁线索，章末以「祖母的声音」制造超自然悬置，留给第13章解释。"

        private fun payload(op: String, title: String, current: String?, change: String): String =
            """{"op":"$op","title":"$title","current":${current?.let { "\"$it\"" } ?: "null"},"change":"$change","origin":"第12章 · 本轮写作"}"""

        val APPROVAL_CALLS = listOf(
            ToolCall(
                id = "call-edit-outline",
                name = "novel_edit_outline",
                arguments = payload(
                    "edit",
                    "第12章大纲节点 · 追逃与闸门",
                    "灰烬被猎队堵在晾房，交出铜管，被押回神殿。",
                    "灰烬经晾房下到负二层，于第三道闸反向利用排水渠脱身；章末悬置于黑暗中的指引声，第13章揭晓。",
                ),
            ),
            ToolCall(
                id = "call-add-location",
                name = "novel_add_location",
                arguments = payload(
                    "add",
                    "新地点 · 负三层泄洪闸",
                    null,
                    "旱年废弃的防洪设施，铁锈与旧水气味；第三道闸东侧有哑仆维护的暗记——本卷后段成为灰烬的临时据点。",
                ),
            ),
            ToolCall(
                id = "call-remove-character",
                name = "novel_remove_character",
                arguments = payload(
                    "delete",
                    "移除人物 · 夜巡「乙」",
                    "夜巡乙：负责西廊巡视，第3章出场后无后续情节。",
                    "与甲职能重复；其「两长哨声」职能并入猎队队长，强化单一威慑源。",
                ),
            ),
        )

        val HISTORY = listOf(
            DemoHistoryRun(
                userText = "帮我起个卷名，要有「余烬」与「长夜」的意象。",
                assistantText = "《长夜余烬》如何——余烬是火剩下的部分，长夜是还没过去的时间；书名先给温度，再给等待。",
            ),
            DemoHistoryRun(
                userText = "把第11章结尾的铜管线索再收紧一点，别让它看起来像一次性道具。",
                assistantText = "已把铜管改为灰烬随身的半截遗物（与祖母的枣核成对），并在大纲节点12预埋「负二层排水渠」出口——道具两次入景之后，第三次才能救她的命。",
                toolName = "novel_read_outline",
                toolSummary = "第11章 · 晾房与铜管（已读）",
            ),
        )
    }
}

/** 翻页历史段（loadOlder）：模板化生成的更旧对话，每段 50 个 run */
internal fun olderSegment(segIndex: Int, runsPerSegment: Int = 50): List<ChatItem> {
    val chapter = 11 - segIndex // 段1 = 第11章之前，段2 = 更早
    return buildList {
        repeat(runsPerSegment) { i ->
            val n = segIndex * runsPerSegment + i
            val ch = chapter - i / 3
            add(ChatItem.UserMsg("h-$n-u", "继续第${ch}章第${i % 3 + 1}段，保持当前的叙事节奏。"))
            add(
                ChatItem.AssistantMsg(
                    "h-$n-a",
                    "（历史归档 · 第${ch}章片段 ${i + 1}）已按既定大纲推进：场景切换保持两景一转，" +
                        "对话压缩到三句以内，段末留一个未闭合的动作钩子。",
                ),
            )
        }
    }
}
