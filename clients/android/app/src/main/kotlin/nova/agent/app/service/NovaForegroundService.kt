package nova.agent.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import nova.agent.app.MainActivity
import nova.agent.app.NovaApplication

/**
 * 保活前台服务（PRD FR8）：**纯生命周期壳**——不拥有任何业务协程
 * （会话执行挂 AppContainer.applicationScope，§1.2-⑦）；本 service 是
 * 「持租约 ∨ 活跃 run ∨ Watcher 活跃」谓词的执行器与通知渲染器。
 *
 * - START_NOT_STICKY：被杀不自动重启（恢复走冷启动 journal 溯源，FR3/FR10）；
 * - 空闲 stopSelf（intentional）不触发优雅退场；系统杀（onDestroy 非 intentional /
 *   onTaskRemoved）→ 协调层 onKeepAliveLost()（停 run 落 ABORTED → release → 停 SSE）；
 * - 通知 = 谓词 StateFlow 渲染（思考/生成/审批等待），点击回 MainActivity（singleTask）。
 */
class NovaForegroundService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var intentionalStop = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val container = (application as NovaApplication).container
        NovaNotifier.ensureChannels(this)
        startAsForeground(getString(nova.agent.app.R.string.fgs_syncing))

        scope.launch {
            container.conversationCoordinator.fgsLine.collect { line ->
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.notify(NovaNotifier.MAIN_NOTIFICATION_ID, buildNotification(line))
            }
        }
        scope.launch {
            container.conversationCoordinator.fgsRequired.collect { required ->
                if (!required) {
                    intentionalStop = true
                    stopSelf()
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun startAsForeground(line: String) {
        val notification = buildNotification(line)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NovaNotifier.MAIN_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NovaNotifier.MAIN_NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(line: String): Notification {
        val tap = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, NovaNotifier.CHANNEL_STATUS)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("nova")
            .setContentText(line)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap)
            .build()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // 任务滑走：活跃工作优雅退场（不依赖 5 分钟宽限——空闲即停语义下活跃即代表有 run/租约）
        (application as NovaApplication).container.conversationCoordinator.onKeepAliveLost()
        intentionalStop = true
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        scope.cancel()
        if (!intentionalStop) {
            // 系统回收：不让悬挂 run 留在半空（下次冷启动还有 journal 溯源兜底）
            ((application as? NovaApplication)?.container)?.conversationCoordinator?.onKeepAliveLost()
        }
        super.onDestroy()
    }

    companion object {
        fun start(context: Context) {
            context.startForegroundService(Intent(context, NovaForegroundService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, NovaForegroundService::class.java))
        }
    }
}
