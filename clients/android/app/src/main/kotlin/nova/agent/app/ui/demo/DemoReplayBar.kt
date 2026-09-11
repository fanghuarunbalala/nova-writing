package nova.agent.app.ui.demo

import android.content.Context
import android.content.Intent
import android.os.Process
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaThemeKind

/**
 * Debug 演示浮条（等价 demo HTML 底部控制条）：重置（进程重启回初始态）/ 主题轮换 /
 * 三个覆盖层旁路触发（409 冲突 / SSE 断线 / 只读租约）。release 构建不组合（调用方 BuildConfig 门）。
 */
@Composable
fun DemoReplayBar(
    theme: NovaThemeKind,
    modifier: Modifier = Modifier,
    onCycleTheme: () -> Unit,
    onConflict: () -> Unit,
    onDisconnect: () -> Unit,
    onLease: () -> Unit,
) {
    val context = LocalContext.current

    Row(
        modifier
            .background(Color(0xD9000000), RoundedCornerShape(99.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        DemoChip("重置") { restartApp(context) }
        DemoChip("主题·${theme.label}") { onCycleTheme() }
        DemoChip("409") { onConflict() }
        DemoChip("断线") { onDisconnect() }
        DemoChip("只读") { onLease() }
    }
}

@Composable
private fun DemoChip(label: String, onClick: () -> Unit) {
    Text(
        label,
        color = Color(0xFFE8E4DE),
        fontSize = 11.sp,
        modifier = Modifier
            .clickable { onClick() }
            .padding(horizontal = 8.dp, vertical = 6.dp),
    )
}

/** 进程级重启：清空所有演示状态回到冷启动（launcher intent + 自杀） */
private fun restartApp(context: Context) {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    context.startActivity(intent)
    Process.killProcess(Process.myPid())
}
