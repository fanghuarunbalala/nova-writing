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
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography

/**
 * 只读态横幅（PRD FR7.7）：他端持有租约 → 设备名 + 剩余秒倒计时 + SSE 进度（seq 增长）+ 接续按钮。
 * 「接续」demo：点击触发 409 冲突对话框（Step 7 旁路按钮同样走 oneShot）。
 */
@Composable
fun ReadOnlyBanner(lease: ReadOnlyLease, onResume: () -> Unit) {
    val palette = LocalNovaPalette.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 4.dp)
            .background(palette.warnBg, RoundedCornerShape(9.dp))
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text("只读 · ${lease.deviceName} 正在写作", style = NovaTypography.labelMedium)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                CountDown(lease.expiresAt)
                Text("·", color = palette.warn40)
                Text("SSE seq ${lease.seq}", style = NovaText.mono11)
            }
        }
        Text(
            "接续",
            style = NovaTypography.labelMedium,
            color = palette.warn,
            modifier = Modifier
                .background(palette.warn40, RoundedCornerShape(99.dp))
                .clickable { onResume() }
                .padding(horizontal = 14.dp, vertical = 6.dp),
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
    Text("剩余 ${left}s", style = NovaText.mono12.copy(color = palette.warn))
}
