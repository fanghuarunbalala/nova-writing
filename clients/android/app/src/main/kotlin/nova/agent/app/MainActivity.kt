package nova.agent.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import nova.agent.app.service.NovaForegroundService
import nova.agent.app.service.NovaNotifier
import nova.agent.app.ui.nav.Screen

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as NovaApplication).container
        requestNotificationPermissionOnce()
        handleDeepLink(intent)

        // 生命周期矩阵（§1.2-⑨ / FR8）：ON_START 刷审批聚合 + 撤审批通知 + FGS 启停评估
        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> {
                    container.appInForeground.value = true
                    NovaNotifier.cancelApprovals(this)
                    container.onAppForeground()
                }
                Lifecycle.Event.ON_STOP -> container.appInForeground.value = false
                else -> Unit
            }
        })

        setContent {
            NovaApp(container)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    /** 通知深链：审批通知 → 审批中心（singleTask 重建走这里）。 */
    private fun handleDeepLink(intent: Intent?) {
        val open = intent?.getStringExtra("open") ?: return
        val container = (application as NovaApplication).container
        when (open) {
            "approvals" -> container.pendingRoute.value = Screen.ApprovalCenter
        }
    }

    /** POST_NOTIFICATIONS（API 33+）：拒绝不阻断——通知缺失不影响功能（PRD FR8）。 */
    private fun requestNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
    }
}
