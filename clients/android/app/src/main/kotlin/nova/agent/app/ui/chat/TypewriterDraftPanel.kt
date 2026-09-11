package nova.agent.app.ui.chat

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.brandBrush

/**
 * 打字机草稿面板（demo .draftPanel）：
 * - 品牌渐变 1.5dp 描边容器（surface 底）
 * - kicker「正文草稿」渐变小字 + 右上「已生成 N 字」
 * - 正文 15.5sp 衬线 1.95 行距，尾部 500 字窗口（长草稿不撑爆面板，全文收口后进正文块）
 * - Caret 与 draft 文本依赖隔离：闪烁只在 draw 层（graphicsLayer），32ms 级重组不失效
 */
@Composable
fun TypewriterDraftPanel(draft: String) {
    val palette = LocalNovaPalette.current
    val tailWindow = 500
    val shown = if (draft.length > tailWindow) draft.takeLast(tailWindow) else draft

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 6.dp)
            .border(
                width = 1.5.dp,
                brush = palette.brandBrush(),
                shape = RoundedCornerShape(NovaDimens.radiusMd),
            )
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "正文草稿",
                style = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold, brush = palette.brandBrush()),
                modifier = Modifier.weight(1f),
            )
            Text(
                "已生成 ${draft.length} 字",
                style = NovaText.mono11.copy(color = palette.faint, fontWeight = FontWeight.Normal),
            )
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                shown,
                style = NovaText.draft.copy(color = palette.fg),
                maxLines = 8,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Caret(Modifier.padding(start = 2.dp, bottom = 4.dp))
        }
    }
}

/**
 * 插入符：1.1s 方波闪烁（demo caret-blink steps(2)：0–49% 可见 / 50–100% 隐藏）。
 * alpha 只经 graphicsLayer 读取 → 文本每 32ms 重组不影响本组。
 */
@Composable
fun Caret(modifier: Modifier = Modifier) {
    val palette = LocalNovaPalette.current
    val blink = rememberInfiniteTransition(label = "caret").animateFloat(
        initialValue = 1f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = NovaDimens.CARET_BLINK_MS
                1f at NovaDimens.CARET_BLINK_MS * 49 / 100
                0f at NovaDimens.CARET_BLINK_MS / 2
                0f at NovaDimens.CARET_BLINK_MS
            },
        ),
        label = "blink",
    )
    Box(
        modifier
            .width(2.dp)
            .height(18.dp)
            .graphicsLayer { alpha = blink.value }
            .background(palette.accent, RoundedCornerShape(1.dp)),
    )
}
