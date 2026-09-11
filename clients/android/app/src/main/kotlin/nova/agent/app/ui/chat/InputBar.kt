package nova.agent.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import nova.agent.app.data.ExecMode
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.theme.brandBrush

/**
 * 输入条（demo composer）：14dp 圆角输入卡 + 三档执行模式菜单 + 发送/排队/停止。
 * - 空闲：发送 = 品牌渐变圆钮
 * - 运行中：有输入 → 发送变「排队」语义（幽灵上屏）；无输入 → 停止钮
 */
@Composable
fun InputBar(
    input: String,
    execMode: ExecMode,
    busy: Boolean,
    onInputChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onModeChange: (ExecMode) -> Unit,
) {
    val palette = LocalNovaPalette.current
    var menuOpen by remember { mutableStateOf(false) }

    Row(
        Modifier
            .fillMaxWidth()
            .imePadding()
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .heightIn(min = 52.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 输入卡（mode chip + 文本域）
        Row(
            Modifier
                .weight(1f)
                .heightIn(min = 52.dp, max = 120.dp)
                .background(palette.surface, RoundedCornerShape(NovaDimens.radiusLg))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            // 三档执行模式
            Box {
                Text(
                    execMode.label,
                    style = NovaTypography.labelSmall,
                    color = palette.accent,
                    modifier = Modifier
                        .padding(bottom = 6.dp)
                        .clickable { menuOpen = true },
                )
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    ExecMode.entries.forEach { mode ->
                        DropdownMenuItem(
                            text = {
                                androidx.compose.foundation.layout.Column {
                                    Text(mode.label, style = NovaTypography.bodyMedium)
                                    Text(mode.hint, style = NovaTypography.labelSmall.copy(color = palette.faint))
                                }
                            },
                            onClick = {
                                onModeChange(mode)
                                menuOpen = false
                            },
                        )
                    }
                }
            }
            BasicTextField(
                value = input,
                onValueChange = onInputChange,
                textStyle = NovaTypography.bodyLarge.copy(color = palette.fg),
                cursorBrush = SolidColor(palette.accent),
                maxLines = 4,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 10.dp, bottom = 4.dp),
                decorationBox = { inner ->
                    if (input.isEmpty()) {
                        androidx.compose.foundation.layout.Box(Modifier.heightIn(min = 24.dp)) {
                            Text("续写、追问或讨论…", style = NovaTypography.bodyLarge.copy(color = palette.faint))
                        }
                    }
                    inner()
                },
            )
        }

        // 发送 / 排队 / 停止
        val showStop = busy && input.isBlank()
        val canSend = input.isNotBlank() && !showStop
        Box(
            modifier = Modifier
                .size(NovaDimens.sendButton)
                .background(
                    if (showStop) SolidColor(palette.danger32) else palette.brandBrush(),
                    CircleShape,
                )
                .clickableEnabled(canSend || showStop) { if (showStop) onStop() else onSend() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (showStop) Icons.Outlined.Stop else Icons.Outlined.ArrowUpward,
                contentDescription = if (showStop) "停止" else if (busy) "排队" else "发送",
                tint = if (showStop) palette.danger else palette.onAccent,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

private fun Modifier.clickableEnabled(enabled: Boolean, onClick: () -> Unit): Modifier =
    if (enabled) this.clickable(onClick = onClick) else this
