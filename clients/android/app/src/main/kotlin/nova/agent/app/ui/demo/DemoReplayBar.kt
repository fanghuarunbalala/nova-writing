package nova.agent.app.ui.demo

import android.content.Context
import android.content.Intent
import android.os.Process
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import nova.agent.app.ui.theme.NovaThemeKind

/**
 * Debug 演示浮条（等价 demo HTML 控制条）：默认收成一颗「演示」小丸，点开才展开整条，
 * 键盘弹起时整体隐藏（调用方门）。release 构建不组合（调用方 BuildConfig 门）。
 * 同样的触发器在抽屉「演示控制」区也有一份（更易发现）。
 */
@Composable
fun DemoReplayBar(
    theme: NovaThemeKind,
    leaseActive: Boolean,
    modifier: Modifier = Modifier,
    onCycleTheme: () -> Unit,
    onConflict: () -> Unit,
    onDisconnect: () -> Unit,
    onLease: () -> Unit,
) {
    val context = LocalContext.current
    var expanded by rememberSaveable { mutableStateOf(false) }

    Column(
        modifier
            .background(Color(0xD9000000), RoundedCornerShape(99.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        if (expanded) {
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                DemoChip("重置") { restartApp(context) }
                DemoChip("主题·${theme.label}") { onCycleTheme() }
                DemoChip("409") { onConflict() }
                DemoChip("断线") { onDisconnect() }
                DemoChip(if (leaseActive) "清除只读" else "只读") { onLease() }
            }
            Row(Modifier.padding(start = 4.dp)) {
                DemoChip("收起 ▴") { expanded = false }
            }
        } else {
            Row {
                DemoChip("演示 ▾") { expanded = true }
            }
        }
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
internal fun restartApp(context: Context) {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    context.startActivity(intent)
    Process.killProcess(Process.myPid())
}
