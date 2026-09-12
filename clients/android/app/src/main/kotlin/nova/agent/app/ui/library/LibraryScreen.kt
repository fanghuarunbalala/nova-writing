package nova.agent.app.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CollectionsBookmark
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import nova.agent.app.ui.common.ScreenScaffold
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography

private val demoBooks = listOf(
    Triple("雾都灯影录", "公共书库 · 悬疑", "12.4 万次引用"),
    Triple("南疆异闻补遗", "公共书库 · 志怪", "8.1 万次引用"),
)

/** 书库（PRD FR10）：云端共享书库占位——契约未定（cloud-project-api v1.2），先展示 2 条只读 demo */
@Composable
fun LibraryScreen(onBack: () -> Unit) {
    val palette = LocalNovaPalette.current
    ScreenScaffold(title = "书库", onBack = onBack) {
        Column(Modifier.fillMaxSize().padding(14.dp)) {
            Text(
                "云端共享书库 · 契约未定（v1.2）",
                style = NovaText.kai.copy(color = palette.muted),
                modifier = Modifier.padding(vertical = 10.dp),
            )
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(demoBooks) { (name, tag, cites) ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(Icons.Outlined.CollectionsBookmark, contentDescription = null, tint = palette.accent, modifier = Modifier.size(20.dp))
                        Column(Modifier.weight(1f)) {
                            Text(name, style = NovaTypography.bodyLarge)
                            Text(tag, style = NovaTypography.labelSmall.copy(color = palette.faint))
                        }
                        Text(cites, style = NovaText.mono12.copy(color = palette.muted))
                    }
                }
            }
        }
    }
}
