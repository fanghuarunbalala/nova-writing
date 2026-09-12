package nova.agent.app.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import nova.agent.app.MainActivity
import nova.agent.net.sse.ServerEvent

/** 通知组件（FR8）：常驻 run 状态通道 + 审批到达通道（深链审批中心）。 */
object NovaNotifier {

    const val CHANNEL_STATUS = "nova_status"
    const val CHANNEL_APPROVALS = "nova_approvals"
    const val MAIN_NOTIFICATION_ID = 1001
    const val APPROVAL_NOTIFICATION_ID = 2002

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_STATUS, "写作进度", NotificationManager.IMPORTANCE_MIN).apply {
                description = "会话运行/租约保持的常驻状态"
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_APPROVALS, "审批请求", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "跨端工具调用审批到达（120s 超时）"
            }
        )
    }

    /** 审批到达通知（应用后台时；深链审批中心，singleTask + SINGLE_TOP 防双实例）。 */
    fun notifyApproval(context: Context, event: ServerEvent.ApprovalRequested, background: Boolean) {
        if (!background) return // 前台时审批 Sheet 直接接管（§1.2-⑨①）
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val tap = PendingIntent.getActivity(
            context,
            1,
            Intent(context, MainActivity::class.java)
                .putExtra("open", "approvals")
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, CHANNEL_APPROVALS)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("审批请求")
            .setContentText(
                "${(event.calls as? kotlinx.serialization.json.JsonArray)?.size ?: 0} 项变更待确认 · 120s 内裁决"
            )
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        nm.notify(APPROVAL_NOTIFICATION_ID, n)
    }

    /** 回前台：审批通知让位给审批 Sheet。 */
    fun cancelApprovals(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(APPROVAL_NOTIFICATION_ID)
    }
}
