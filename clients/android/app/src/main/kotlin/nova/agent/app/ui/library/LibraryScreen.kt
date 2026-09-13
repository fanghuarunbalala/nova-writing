package nova.agent.app.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import nova.agent.app.ui.common.ScreenScaffold
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography

private data class DemoBook(val spine: String, val name: String, val stats: String)

/** demo bookRow（L1453-1463）：书脊方块 + 书名 + 统计 + 「云端最新」chip */
private val demoBooks = listOf(
    DemoBook("夜", "长夜行", "142 章 · 310 万字 · 幕 24 · 人物 31"),
    DemoBook("雾", "雾都十夜", "68 章 · 94 万字 · 幕 12 · 人物 22"),
)

/** 书库（PRD FR10）：云端共享书库——契约未定（cloud-project-api v1.2），先展示 2 条只读 demo */
@Composable
fun LibraryScreen(onBack: () -> Unit) {
    val palette = LocalNovaPalette.current
    ScreenScaffold(title = "书库", onBack = onBack) {
        Column(Modifier.fillMaxSize().padding(14.dp)) {
            Text(
                "云端共享 · 只读引用 · 跨项目",
                style = NovaTypography.labelMedium.copy(color = palette.muted),
                modifier = Modifier.padding(vertical = 10.dp),
            )
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(demoBooks) { book ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(
                            Modifier
                                .size(36.dp)
                                .background(palette.accent9, RoundedCornerShape(8.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(book.spine, color = palette.accent, style = NovaText.kai.copy(fontSize = 16.sp))
                        }
                        Column(Modifier.weight(1f)) {
                            Text(book.name, style = NovaTypography.bodyLarge)
                            Text(book.stats, style = NovaText.mono12.copy(color = palette.faint))
                        }
                        Text(
                            "云端最新",
                            style = NovaTypography.labelSmall,
                            color = palette.success,
                            modifier = Modifier
                                .background(palette.successBg, RoundedCornerShape(99.dp))
                                .padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                }
                item {
                    Text(
                        "书库随云端项目共享（解析管线在云端进行，移动端不做导入）；只读消费：幕级大纲 / 人物 / 地点 / 风格 / 摘录，" +
                            "会话中经 library.read 引用——正文引用一律 paragraph id。",
                        style = NovaText.kai.copy(color = palette.faint),
                        modifier = Modifier.padding(vertical = 12.dp),
                    )
                }
            }
        }
    }
}
