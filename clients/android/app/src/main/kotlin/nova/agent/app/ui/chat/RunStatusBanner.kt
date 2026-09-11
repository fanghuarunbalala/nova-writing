package nova.agent.app.ui.chat

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import nova.agent.app.data.RunStatus
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.theme.brandBrush
import nova.agent.app.ui.theme.warnTextBrush

/**
 * 五态条（demo .genRow）。按 demo 实测修正：
 * 思考 = 星标上下浮动（bob 1.5s）+ 品牌渐变文字 + 等宽计秒（非三点呼吸）。
 * 等待审批 = --grad-warn-text 渐变 + 图标摆动（sway 2.8s）。
 * 动画全部走 graphicsLayer（draw 层），不产生重组。
 */
@Composable
fun RunStatusBanner(
    status: RunStatus,
    runStartedAt: Long?,
    draftCount: Int,
    onRetry: () -> Unit,
) {
    if (status == RunStatus.Idle) return
    val palette = LocalNovaPalette.current

    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 6.dp)
            .height(30.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when (status) {
            RunStatus.Thinking -> {
                BobbingIcon { Icon(Icons.Rounded.AutoAwesome, null, tint = palette.accent, modifier = Modifier.size(19.dp)) }
                GradientLabel("深度思考中", palette.brandBrush())
                runStartedAt?.let { ElapsedSince(it) }
            }
            RunStatus.Generating -> {
                BobbingIcon { Icon(Icons.Rounded.AutoAwesome, null, tint = palette.orange, modifier = Modifier.size(19.dp)) }
                GradientLabel("生成中 · $draftCount 字", palette.brandBrush())
            }
            RunStatus.WaitingApproval -> {
                SwayingIcon { Icon(Icons.Rounded.HourglassTop, null, tint = palette.warn, modifier = Modifier.size(18.dp)) }
                GradientLabel("正在审批 · 等待裁决", warnTextBrush())
            }
            RunStatus.WaitingAnswer -> {
                Icon(Icons.Rounded.AutoAwesome, null, tint = palette.accent, modifier = Modifier.size(18.dp))
                GradientLabel("等待作答 · 见消息中的追问卡", palette.brandBrush())
            }
            RunStatus.FailedRetry -> {
                ShakeIcon { Icon(Icons.Rounded.Refresh, null, tint = palette.danger, modifier = Modifier.size(18.dp)) }
                Text("生成失败 · provider 超时（demo）", style = NovaTypography.bodySmall.copy(color = palette.danger))
                Text(
                    "重试",
                    color = palette.danger,
                    style = NovaTypography.labelMedium,
                    modifier = Modifier
                        .background(palette.danger12, RoundedCornerShape(99.dp))
                        .clickable { onRetry() }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
            RunStatus.Idle -> Unit
        }
    }
}

/** 品牌渐变文字（CSS background-clip: text 的 Compose 对应物） */
@Composable
private fun GradientLabel(text: String, brush: Brush) {
    Text(
        text,
        style = TextStyle(
            fontSize = NovaTypography.bodySmall.fontSize,
            fontWeight = FwMedium,
            brush = brush,
        ),
    )
}

/** 星标浮动：0 → -3dp → 0，1.5s ease-in-out 往复；只在 draw 层 */
@Composable
private fun BobbingIcon(content: @Composable () -> Unit) {
    val t = rememberInfiniteTransition(label = "bob")
    val dy by t.animateFloat(
        0f, -3f,
        infiniteRepeatable(tween(750, easing = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)), RepeatMode.Reverse),
        label = "dy",
    )
    Box(Modifier.graphicsLayer { translationY = dy }) { content() }
}

/** 审批等待摆动：-12° ↔ 12°，2.8s；只在 draw 层 */
@Composable
private fun SwayingIcon(content: @Composable () -> Unit) {
    val t = rememberInfiniteTransition(label = "sway")
    val angle by t.animateFloat(
        -12f, 12f,
        infiniteRepeatable(tween(1400, easing = CubicBezierEasing(0.45f, 0f, 0.55f, 1f)), RepeatMode.Reverse),
        label = "angle",
    )
    Box(Modifier.graphicsLayer { rotationZ = angle }) { content() }
}

/** 失败抖动：±3px，0.45s 一轮；只在 draw 层 */
@Composable
private fun ShakeIcon(content: @Composable () -> Unit) {
    val t = rememberInfiniteTransition(label = "shake")
    val dx by t.animateFloat(
        -3f, 3f,
        infiniteRepeatable(
            androidx.compose.animation.core.keyframes {
                durationMillis = 450
                3f at 56
                -3f at 112
                3f at 168
                -3f at 224
                3f at 280
                -3f at 337
                3f at 393
                -3f at 450
            },
        ),
        label = "dx",
    )
    Box(Modifier.graphicsLayer { translationX = dx }) { content() }
}

/** 等宽计秒（demo mono tabular-nums）；离开组合自动取消 */
@Composable
fun ElapsedSince(ts: Long, prefix: String = "") {
    val palette = LocalNovaPalette.current
    var seconds by remember(ts) { mutableLongStateOf(((System.currentTimeMillis() - ts) / 1000).coerceAtLeast(0)) }
    LaunchedEffect(ts) {
        while (isActive) {
            seconds = ((System.currentTimeMillis() - ts) / 1000).coerceAtLeast(0)
            delay(1000)
        }
    }
    Text("${prefix}${seconds}s", style = NovaText.mono12.copy(color = palette.muted))
}
