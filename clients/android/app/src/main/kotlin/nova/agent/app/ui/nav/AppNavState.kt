package nova.agent.app.ui.nav

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * v5 导航：手写极简路由栈（不引 Navigation Compose）。
 * 基座 ChatScreen 永不入栈——stack 只存全屏覆盖路由。
 */
sealed interface Screen {
    data object Chat : Screen
    data object Settings : Screen
    data object Devices : Screen
    data object ApprovalCenter : Screen
    data object Library : Screen
}

class AppNavState {
    var stack by mutableStateOf<List<Screen>>(emptyList())
        private set

    val current: Screen get() = stack.lastOrNull() ?: Screen.Chat

    fun push(screen: Screen) {
        if (stack.lastOrNull() != screen) stack = stack + screen
    }

    /** @return true 表示消费了本次返回（弹路由），false = 栈已空（交系统退出） */
    fun pop(): Boolean {
        if (stack.isEmpty()) return false
        stack = stack.dropLast(1)
        return true
    }

    fun reset() {
        stack = emptyList()
    }
}

/** 返回键优先级目标：sheet > 抽屉 > 路由栈 > 退出 */
enum class BackTarget { CLOSE_SHEET, CLOSE_DRAWER, POP_ROUTE }

/**
 * 纯函数：给定三态判定返回键应消费的目标（null = 不拦截，交系统）。
 * sheetExpanded = 内容页未完全收起（含半展）；drawerOpen = 抽屉打开。
 */
fun backTarget(sheetExpanded: Boolean, drawerOpen: Boolean, stackDepth: Int): BackTarget? = when {
    sheetExpanded -> BackTarget.CLOSE_SHEET
    drawerOpen -> BackTarget.CLOSE_DRAWER
    stackDepth > 0 -> BackTarget.POP_ROUTE
    else -> null
}
