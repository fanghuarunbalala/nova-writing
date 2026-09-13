package nova.agent.app.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import nova.agent.app.data.ChatItem
import nova.agent.app.data.PillKind
import nova.agent.app.data.ToolPhase
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.theme.NovaDimens.CARET_BLINK_MS

/* ============ 轮次分隔线（demo roundDivider：细线夹 mono 小字） ============ */

@Composable
fun RoundLabelView(item: ChatItem.RoundLabel) {
    val palette = LocalNovaPalette.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .weight(1f)
                .height(1.dp)
                .background(palette.borderStrong),
        )
        Text(item.text, style = NovaText.mono11.copy(color = palette.faint, fontSize = 10.5.sp))
        Box(
            Modifier
                .weight(1f)
                .height(1.dp)
                .background(palette.borderStrong),
        )
    }
}

/* ============ 用户气泡（demo .msgUser：右侧、82% 宽、accent-9 底、尾角 4dp） ============ */

@Composable
fun UserBubble(item: ChatItem.UserMsg) {
    val palette = LocalNovaPalette.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Text(
            item.text,
            style = NovaTypography.bodyLarge.copy(lineHeight = NovaTypography.bodyLarge.lineHeight),
            color = palette.fg,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .background(palette.accent9, RoundedCornerShape(14.dp, 14.dp, 4.dp, 14.dp))
                .padding(horizontal = 13.dp, vertical = 9.dp),
        )
    }
}

/* ============ 正文块（demo .aiProse：衬线 15.5/1.85 + 可展开推理） ============ */

@Composable
fun AssistantBlock(item: ChatItem.AssistantMsg, onToggleReasoning: () -> Unit) {
    val palette = LocalNovaPalette.current
    Column(Modifier.widthIn(max = 360.dp)) {
        if (item.reasoning != null) {
            Row(
                Modifier
                    .clickable { onToggleReasoning() }
                    .padding(vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("深度思考", style = NovaTypography.labelSmall.copy(color = palette.faint))
                Icon(
                    Icons.Rounded.ExpandMore,
                    contentDescription = if (item.reasoningExpanded) "收起推理" else "展开推理",
                    tint = palette.faint,
                    modifier = Modifier
                        .size(14.dp)
                        .graphicsLayer { rotationZ = if (item.reasoningExpanded) 180f else 0f },
                )
            }
            AnimatedVisibility(
                visible = item.reasoningExpanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Text(
                    item.reasoning,
                    style = NovaTypography.bodySmall.copy(color = palette.muted),
                    modifier = Modifier
                        .padding(vertical = 4.dp)
                        .background(palette.surface2, RoundedCornerShape(NovaDimens.radiusSm))
                        .padding(10.dp),
                )
            }
        }
        Text(item.text, style = NovaText.prose.copy(color = palette.fg))
    }
}

/* ============ 工具行三态（demo .toolLine：RUN 计秒 / OK ✓ / FAIL ✗） ============ */

@Composable
fun ToolRow(item: ChatItem.ToolLine) {
    val palette = LocalNovaPalette.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.padding(vertical = 2.dp),
    ) {
        when (val phase = item.phase) {
            is ToolPhase.Run -> {
                Spinner13()
                Text("正在调用", style = NovaTypography.bodySmall)
                Text(item.name, style = NovaText.mono12)
                Text("·", color = palette.faint)
                PulsingText { ElapsedSince(phase.ts) }
            }
            ToolPhase.Ok -> {
                Icon(
                    Icons.Rounded.Check,
                    contentDescription = "成功",
                    tint = palette.success,
                    modifier = Modifier.size(14.dp),
                )
                Text(item.name, style = NovaText.mono12, color = palette.muted)
                if (item.summary.isNotBlank()) {
                    Text("· ${item.summary}", style = NovaTypography.bodySmall.copy(color = palette.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            is ToolPhase.Fail -> {
                Icon(Icons.Rounded.Close, contentDescription = "失败", tint = palette.danger, modifier = Modifier.size(14.dp))
                Text(item.name, style = NovaText.mono12, color = palette.danger)
                Text("· ${phase.error}", style = NovaTypography.bodySmall.copy(color = palette.danger), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** 13dp 双色 spinner（demo：warn-40 轨道 + warn 弧，0.8s/圈） */@Composable
private fun Spinner13() {
    val palette = LocalNovaPalette.current
    val t = rememberInfiniteTransition(label = "spin")
    val sweep by t.animateFloat(0f, 360f, infiniteRepeatable(tween(800)), label = "sweep")
    androidx.compose.foundation.Canvas(modifier = Modifier.size(13.dp)) {
        val stroke = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round)
        drawArc(color = palette.warn40, startAngle = 0f, sweepAngle = 360f, useCenter = false, style = stroke)
        drawArc(color = palette.warn, startAngle = sweep, sweepAngle = 270f, useCenter = false, style = stroke)
    }
}

/** 计秒脉冲（demo node-pulse 2.4s：opacity 1 ↔ .35）；draw 层 */
@Composable
private fun PulsingText(content: @Composable () -> Unit) {
    val t = rememberInfiniteTransition(label = "pulse")
    val a by t.animateFloat(1f, 0.35f, infiniteRepeatable(tween(1200), RepeatMode.Reverse), label = "a")
    Box(Modifier.graphicsLayer { alpha = a }) { content() }
}

/* ============ 幽灵排队行（demo .msgGhost：虚线泡 + 排队计秒） ============ */

@Composable
fun GhostQueueRow(item: ChatItem.GhostItem) {
    val palette = LocalNovaPalette.current
    Row(Modifier.fillMaxWidth().alpha(0.72f), horizontalArrangement = Arrangement.End) {
        Column(horizontalAlignment = Alignment.End) {
            Box(
                Modifier
                    .widthIn(max = 300.dp)
                    .background(palette.surface2, RoundedCornerShape(14.dp, 14.dp, 4.dp, 14.dp))
                    .dashedBorder(palette.borderStrong)
                    .padding(horizontal = 13.dp, vertical = 9.dp),
            ) {
                Text(item.text, style = NovaTypography.bodyLarge, color = palette.muted)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                modifier = Modifier.padding(top = 4.dp, end = 4.dp),
            ) {
                PulsingDot(palette.warn)
                Text("排队中", style = NovaTypography.labelSmall.copy(color = palette.warn))
                ElapsedSince(item.enqueuedAt)
            }
        }
    }
}

/** 6dp 警示点 + node-pulse */
@Composable
private fun PulsingDot(color: Color) {
    val t = rememberInfiniteTransition(label = "dot")
    val a by t.animateFloat(1f, 0.35f, infiniteRepeatable(tween(1200), RepeatMode.Reverse), label = "a")
    Box(
        Modifier
            .size(6.dp)
            .graphicsLayer { alpha = a }
            .background(color, CircleShape),
    )
}

private fun Modifier.dashedBorder(color: Color): Modifier = drawBehind {
    val stroke = Stroke(
        width = 1.dp.toPx(),
        pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())),
    )
    val r = 14.dp.toPx()
    drawRoundRect(color = color, cornerRadius = CornerRadius(r, r), style = stroke)
}

/* ============ 系统胶囊（demo .sysPill：居中、语义色底） ============ */

@Composable
fun SysPillView(item: ChatItem.SysPill) {
    val palette = LocalNovaPalette.current
    val (bg, fg, border) = when (item.kind) {
        PillKind.WARN -> Triple(palette.warnBg, palette.warn, palette.warn40)
        PillKind.SUCCESS -> Triple(palette.successBg, palette.success, palette.success.copy(alpha = 0.4f))
        PillKind.DANGER -> Triple(palette.dangerBg, palette.danger, palette.danger32)
        PillKind.INFO -> Triple(palette.infoBg, palette.info, palette.info.copy(alpha = 0.4f))
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        Text(
            item.text,
            style = NovaTypography.bodySmall.copy(color = fg, fontWeight = FwMedium),
            modifier = Modifier
                .background(bg, RoundedCornerShape(99.dp))
                .drawBehind {
                    drawRoundRect(
                        color = border,
                        cornerRadius = CornerRadius(99.dp.toPx(), 99.dp.toPx()),
                        style = Stroke(1.dp.toPx()),
                    )
                }
                .padding(horizontal = 14.dp, vertical = 7.dp),
        )
    }
}

/* ============ 追问卡（阶段4接真实交互；先占位展示） ============ */

@Composable
fun AskCardView(item: ChatItem.AskCard) {
    val palette = LocalNovaPalette.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(palette.surface, RoundedCornerShape(NovaDimens.radiusLg))
            .padding(14.dp),
    ) {
        Text(item.question, style = NovaTypography.titleSmall)
        Spacer(Modifier.padding(top = 8.dp))
        item.options.forEach { option ->
            Text(
                "○  $option",
                style = NovaTypography.bodyMedium.copy(color = palette.muted),
                modifier = Modifier.padding(vertical = 6.dp),
            )
        }
        Text("（追问交互 · 阶段 4 接入）", style = NovaTypography.labelSmall.copy(color = palette.faint))
    }
}

/* ============ 载入更早（触顶自动 + 手动兜底） ============ */

@Composable
fun LoadOlderRow(loading: Boolean, onClick: () -> Unit) {
    val palette = LocalNovaPalette.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 1.5.dp, color = palette.muted)
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier
                    .clickable { onClick() }
                    .background(palette.surface2, RoundedCornerShape(99.dp))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Icon(Icons.Outlined.History, contentDescription = null, tint = palette.muted, modifier = Modifier.size(13.dp))
                Text("载入更早的对话", style = NovaTypography.labelMedium.copy(color = palette.muted, fontWeight = FontWeight.Normal))
            }
        }
    }
}
