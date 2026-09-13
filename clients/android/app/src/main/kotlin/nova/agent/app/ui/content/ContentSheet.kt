package nova.agent.app.ui.content

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import nova.agent.app.data.CloudProject
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography

/**
 * 内容页骨架（PRD FR11）：BottomSheetScaffold 的 sheetContent。
 * 折叠时露出 peek 卡（书名 + 进度 + go，点击/上拉展开）；展开后四 tab（大纲/正文/人物/地点），内容 = 阶段4占位。
 * tab 为受控状态（宿主持有）：实体胶囊（entChip）点击跳转对应 tab 依赖此设计（PRD FR2.2）。
 */
@Composable
fun ContentSheet(
    project: CloudProject?,
    tab: Int = 0,
    onTabChange: (Int) -> Unit = {},
    onExpand: () -> Unit = {},
) {
    val palette = LocalNovaPalette.current
    val tabs = listOf("大纲", "正文", "人物", "地点")

    Column(
        Modifier
            .fillMaxWidth()
            .background(palette.surface)
            .padding(bottom = 24.dp),
    ) {
        // ---- peek 卡区域（折叠态可见高度；点击展开） ----
        Row(
            Modifier
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .fillMaxWidth()
                .background(palette.surface, RoundedCornerShape(18.dp))
                .clickable { onExpand() }
                .padding(start = 12.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 书目头像（demo: 36dp 圆角方块）
            Box(
                Modifier
                    .size(NovaDimens.peekAvatar)
                    .background(palette.accent9, RoundedCornerShape(11.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text("烬", color = palette.accent, style = NovaText.kai.copy(fontSize = 16.sp))
            }
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                Text(project?.name ?: "未打开项目", style = NovaTypography.titleSmall)
                Text(
                    project?.progress ?: "—",
                    style = NovaText.mono12.copy(color = palette.muted),
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Icon(
                Icons.Outlined.ChevronRight,
                contentDescription = "展开内容页",
                tint = palette.muted,
                modifier = Modifier.size(NovaDimens.peekGo),
            )
        }

        // ---- 展开区：四 tab ----
        Row(
            Modifier
                .padding(horizontal = 16.dp, vertical = 6.dp)
                .fillMaxWidth()
                .background(palette.surface2, RoundedCornerShape(NovaDimens.radiusMd))
                .padding(4.dp),
        ) {
            tabs.forEachIndexed { i, label ->
                val selected = tab == i
                Box(
                    Modifier
                        .weight(1f)
                        .padding(horizontal = 2.dp)
                        .height(32.dp)
                        .clip(RoundedCornerShape(NovaDimens.radiusSm))
                        .background(
                            if (selected) palette.surface else androidx.compose.ui.graphics.Color.Transparent,
                            RoundedCornerShape(NovaDimens.radiusSm),
                        )
                        .clickable { if (!selected) onTabChange(i) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        style = NovaTypography.labelMedium.copy(
                            color = if (selected) palette.fg else palette.muted,
                            fontWeight = if (selected) FwMedium else FontWeight.Normal,
                        ),
                        modifier = Modifier.clip(RoundedCornerShape(NovaDimens.radiusSm)).padding(horizontal = 6.dp),
                    )
                }
            }
        }

        // 占位正文（阶段4接 tab 内容）
        Text(
            when (tab) {
                0 -> "大纲树 · 卷/章两级（阶段 4 接入 novel_outline 投影）"
                1 -> "阅读视图 · 16.5sp 衬线 2.05 行距（阶段 4 接入）"
                2 -> "人物卡列表（阶段 4 接入）"
                else -> "地点卡列表（阶段 4 接入）"
            },
            style = NovaText.kai.copy(color = palette.muted),
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
        )
        Spacer(Modifier.height(40.dp))
    }
}

/** peek 卡高度（BottomSheetScaffold.sheetPeekHeight 用） */
val ContentSheetPeekHeight = 76.dp
