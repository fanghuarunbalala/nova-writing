package nova.agent.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.rounded.Pause
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
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.theme.brandBrush

/**
 * 输入条（demo composer）：输入卡（三档模式 + 「待生效」chip + 文本域）+ 暂停钮 + 发送/排队。
 * - 模式切换只挂「待生效」（warn chip），随下一条消息生效（demo pendModeChip / applyModeIfPending）
 * - 运行中恒显暂停钮（demo pauseBtn：当前轮作废，journal 记 ABORTED）
 * - 运行中占位符变「生成中…（可暂停）」；发送 = 排队（幽灵上屏）
 */
@Composable
fun InputBar(
    input: String,
    execMode: ExecMode,
    pendingMode: ExecMode?,
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
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 输入卡（mode chip + 待生效 chip + 文本域）
        Row(
            Modifier
                .weight(1f)
                .heightIn(min = 52.dp, max = 120.dp)
                .background(palette.surface, RoundedCornerShape(NovaDimens.radiusLg))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            // 三档执行模式 + 待生效
            Column(Modifier.padding(bottom = 6.dp)) {
                Box {
                    Text(
                        execMode.label,
                        style = NovaTypography.labelSmall,
                        color = palette.accent,
                        modifier = Modifier.clickable { menuOpen = true },
                    )
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        ExecMode.entries.forEach { mode ->
                            DropdownMenuItem(
                                text = {
                                    Column {
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
                if (pendingMode != null && pendingMode != execMode) {
                    Text(
                        "待生效",
                        style = NovaTypography.labelSmall.copy(color = palette.warn, fontWeight = FwMedium),
                        modifier = Modifier
                            .padding(top = 3.dp)
                            .background(palette.warnBg, RoundedCornerShape(99.dp))
                            .padding(horizontal = 7.dp, vertical = 1.dp),
                    )
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
                        Box(Modifier.heightIn(min = 24.dp)) {
                            Text(
                                if (busy) "生成中…（可暂停）" else "续写、追问或讨论…",
                                style = NovaTypography.bodyLarge.copy(color = palette.faint),
                            )
                        }
                    }
                    inner()
                },
            )
        }

        // 暂停钮（运行中恒显，demo pauseBtn）
        if (busy) {
            Box(
                modifier = Modifier
                    .size(NovaDimens.sendButton)
                    .background(palette.danger32, CircleShape)
                    .clickable { onStop() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Rounded.Pause, contentDescription = "暂停", tint = palette.danger, modifier = Modifier.size(20.dp))
            }
        }

        // 发送 / 排队
        val canSend = input.isNotBlank()
        Box(
            modifier = Modifier
                .size(NovaDimens.sendButton)
                .background(palette.brandBrush(), CircleShape)
                .clickableEnabled(canSend) { onSend() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.ArrowUpward,
                contentDescription = if (busy) "排队" else "发送",
                tint = palette.onAccent,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

private fun Modifier.clickableEnabled(enabled: Boolean, onClick: () -> Unit): Modifier =
    if (enabled) this.clickable(onClick = onClick) else this
