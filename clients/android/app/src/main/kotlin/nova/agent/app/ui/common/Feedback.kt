package nova.agent.app.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** demo snackbar：2.6s 自动消失（android-app-demo.html L1919） */
const val FEEDBACK_DURATION_MS = 2_600L

/** 全局 snackbar 宿主（由 [FeedbackHost] 提供；各屏经 [rememberFeedback] 发消息） */
val LocalSnackbarHostState = staticCompositionLocalOf<SnackbarHostState> {
    error("LocalSnackbarHostState not provided")
}

/**
 * 全局反馈宿主（PRD FR8）：包住主界面，底部居中显示 snackbar。
 * 2.6s 用 withTimeoutOrNull 实现——M3 的 Short 是 4s，与 demo 不符。
 */
@Composable
fun FeedbackHost(content: @Composable () -> Unit) {
    val hostState = remember { SnackbarHostState() }
    CompositionLocalProvider(LocalSnackbarHostState provides hostState) {
        Box(Modifier.fillMaxSize()) {
            content()
            SnackbarHost(
                hostState = hostState,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 96.dp),
            )
        }
    }
}

/** 取反馈函数：调用 `feedback("消息")` 显示 2.6s 后自动消失 */
@Composable
fun rememberFeedback(): (String) -> Unit {
    val hostState = LocalSnackbarHostState.current
    val scope = rememberCoroutineScope()
    return remember(hostState, scope) {
        val show: (String) -> Unit = { message ->
            scope.launch {
                withTimeoutOrNull(FEEDBACK_DURATION_MS) { hostState.showSnackbar(message) }
            }
        }
        show
    }
}
