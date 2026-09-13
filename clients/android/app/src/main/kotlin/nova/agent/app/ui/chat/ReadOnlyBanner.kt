package nova.agent.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import nova.agent.app.data.ReadOnlyLease
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography

/**
 * 只读态横幅（demo roBanner L1142-1153 逐字）：本会话正由他端编辑 + 租约参数行 +
 * 双动作「接续（申请租约）」「只看进度」。
 */
@Composable
fun ReadOnlyBanner(lease: ReadOnlyLease, onResume: () -> Unit, onFollow: () -> Unit) {
    val palette = LocalNovaPalette.current
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 4.dp)
            .background(palette.warnBg, RoundedCornerShape(9.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text("本会话正由 ${lease.deviceName} 编辑", style = NovaTypography.labelMedium.copy(fontWeight = FwMedium))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
            Text("租约持有 ${lease.deviceId} · ", style = NovaText.mono11.copy(color = palette.warn))
            CountDown(lease.expiresAt)
            Text(" · 实时同步对方进度（SSE）· 当前 seq ${lease.seq}", style = NovaText.mono11.copy(color = palette.warn))
        }
        Row(
            modifier = Modifier.padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "接续（申请租约）",
                style = NovaTypography.labelMedium,
                color = palette.warn,
                modifier = Modifier
                    .background(palette.warn40, RoundedCornerShape(99.dp))
                    .clickable { onResume() }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
            Text(
                "只看进度",
                style = NovaTypography.labelMedium,
                color = palette.fg,
                modifier = Modifier
                    .background(palette.surface, RoundedCornerShape(99.dp))
                    .clickable { onFollow() }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
    }
}

/**
 * 只读底部栏（demo roFooter L1274-1280）：只读态替换输入区——「接续（申请租约）」「刷新进度」。
 */
@Composable
fun ReadOnlyFooter(lease: ReadOnlyLease, onResume: () -> Unit, onRefresh: () -> Unit) {
    val palette = LocalNovaPalette.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "接续（申请租约）",
            style = NovaTypography.labelLarge,
            color = palette.warn,
            modifier = Modifier
                .weight(1f)
                .background(palette.warnBg, RoundedCornerShape(99.dp))
                .clickable { onResume() }
                .padding(vertical = 12.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Text(
            "刷新进度 · seq ${lease.seq}",
            style = NovaTypography.labelLarge,
            color = palette.fg,
            modifier = Modifier
                .weight(1f)
                .background(palette.surface, RoundedCornerShape(99.dp))
                .clickable { onRefresh() }
                .padding(vertical = 12.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

/** 剩余秒倒计时（到 0 归零显示 0s） */
@Composable
private fun CountDown(expiresAt: Long) {
    val palette = LocalNovaPalette.current
    var left by remember(expiresAt) {
        mutableLongStateOf(((expiresAt - System.currentTimeMillis()) / 1000).coerceAtLeast(0))
    }
    LaunchedEffect(expiresAt) {
        while (isActive) {
            left = ((expiresAt - System.currentTimeMillis()) / 1000).coerceAtLeast(0)
            delay(1000)
        }
    }
    Text("剩余 ${left}s", style = NovaText.mono11.copy(color = palette.warn))
}
