package nova.agent.app.ui.theme

import androidx.compose.ui.unit.dp

/** demo 布局度量（docs/design/android-app-demo.html :root） */
object NovaDimens {
    // 圆角 token
    val radiusSm = 6.dp   // --radius-sm
    val radiusMd = 9.dp   // --radius-md
    val radiusLg = 14.dp  // --radius-lg
    val radiusSheet = 20.dp // --radius-sheet
    val radiusPill = 999.dp

    // 骨架
    val drawerWidth = 306.dp // --drawer-w
    val topbarHeight = 56.dp // --topbar-h
    val touchMin = 48.dp     // --touch

    // 内容页 peek 卡
    val peekAvatar = 36.dp
    val peekGo = 32.dp
    val peekNotchW = 30.dp
    val peekNotchH = 4.dp
    val peekProgress = 3.dp

    // 消息
    val userBubbleMaxWidthFraction = 0.82f
    val aiBlockMaxWidthFraction = 0.96f

    // 输入条
    val sendButton = 44.dp

    // 动画时长（demo token）
    const val DUR_FAST = 150
    const val DUR_BASE = 220
    const val DUR_DRAWER = 280
    const val DUR_SHEET = 300
    const val DUR_CONTENT_SHEET = 340

    // 循环动画
    const val SPIN_MS = 800       // 工具行 spinner .8s
    const val BOB_MS = 1500       // 思考星标 1.5s
    const val SWAY_MS = 2800      // 审批等待 2.8s
    const val NODE_PULSE_MS = 2400
    const val CARET_BLINK_MS = 1100 // caret-blink 1.1s steps(2)
    const val CARET_LINGER_MS = 700  // 流结束后 caret 再停留
}
