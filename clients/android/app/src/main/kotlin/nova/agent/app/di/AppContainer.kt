package nova.agent.app.di

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import nova.agent.app.data.AppRepository
import nova.agent.app.data.ChatOneShot
import nova.agent.app.data.ChatRepository
import nova.agent.app.data.FakeChatRepository
import nova.agent.app.data.ReadOnlyLease
import nova.agent.app.ui.theme.ThemeStore

/**
 * 手动 DI 容器（Application 持有；阶段3扩 auth/net/room，不引 Hilt/Koin）。
 * Compose 侧经 LocalAppContainer 取容器；业务数据一律走参数传递。
 */
class AppContainer(private val appContext: Context) {

    val applicationScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val themeStore: ThemeStore = ThemeStore(appContext)

    val appRepo: AppRepository = AppRepository(applicationScope)

    /** 阶段2 = FakeChatRepository 脚本回放；阶段3 换 AgentSession 真实现（接口不变） */
    val chatRepo: ChatRepository = FakeChatRepository(applicationScope)

    /** debug 演示旁路：覆盖层（409/断线/只读）的静态触发器，release 剥离入口 */
    val demoTriggers = DemoTriggers()
}

/** 演示信号（抽屉演示控制区 FR9）：ChatViewModel / AppViewModel 消费 */
sealed interface DemoSignal {
    /** 生成失败注入（工具行 FAIL + 五态条 FailedRetry） */
    data object FailGeneration : DemoSignal

    /** 审批超时速演（120s → 6s） */
    data object SpeedApproval : DemoSignal

    /** 连接四态循环（AppViewModel 处理） */
    data object CycleConnection : DemoSignal
}

/** 覆盖层视觉验收的触发源（chat VM 收集） */
class DemoTriggers {
    private val _oneShots = MutableSharedFlow<ChatOneShot>(extraBufferCapacity = 8)
    val oneShots: SharedFlow<ChatOneShot> = _oneShots

    private val _demoEvents = MutableSharedFlow<DemoSignal>(extraBufferCapacity = 8)
    val demoEvents: SharedFlow<DemoSignal> = _demoEvents

    private val _lease = MutableStateFlow<ReadOnlyLease?>(null)
    val lease: StateFlow<ReadOnlyLease?> = _lease

    fun conflict() {
        _oneShots.tryEmit(ChatOneShot.Conflict409("dev_mb14"))
    }

    fun disconnect() {
        _oneShots.tryEmit(ChatOneShot.Disconnected)
    }

    fun failGeneration() {
        _demoEvents.tryEmit(DemoSignal.FailGeneration)
    }

    fun speedUpApproval() {
        _demoEvents.tryEmit(DemoSignal.SpeedApproval)
    }

    fun cycleConnection() {
        _demoEvents.tryEmit(DemoSignal.CycleConnection)
    }

    fun readonlyLease() {
        _lease.value = ReadOnlyLease(
            deviceId = "dev_mb14",
            deviceName = "桌面端 · MacBook Pro",
            expiresAt = System.currentTimeMillis() + 46_000,
            seq = 213,
            ttlSec = 60,
            heartbeatSec = 20,
        )
    }

    fun clearLease() {
        _lease.value = null
    }
}
