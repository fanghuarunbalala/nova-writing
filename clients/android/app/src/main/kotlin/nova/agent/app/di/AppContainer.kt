package nova.agent.app.di

import nova.agent.app.BuildConfig

import android.content.Context
import androidx.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import nova.agent.app.data.ApprovalCenter
import nova.agent.app.data.AppRepository
import nova.agent.app.data.ChatOneShot
import nova.agent.app.data.ChatRepository
import nova.agent.app.data.ChatSideChannels
import nova.agent.app.data.DemoAppRepository
import nova.agent.app.data.FakeChatRepository
import nova.agent.app.data.ReadOnlyLease
import nova.agent.app.data.RealChatRepository
import nova.agent.app.data.ServerAppRepository
import nova.agent.app.data.conversation.ConversationCoordinator
import nova.agent.app.data.conversation.ConversationMeta
import nova.agent.app.data.conversation.ConversationRegistry
import nova.agent.app.data.conversation.LeaseClientTransport
import nova.agent.app.data.conversation.LeaseCoordinator
import nova.agent.app.security.KeystoreTokenCipher
import nova.agent.app.security.KeystoreTokenStore
import nova.agent.app.settings.AppSettingsStore
import nova.agent.app.settings.DataSource
import nova.agent.app.ui.theme.ThemeStore
import nova.agent.data.room.AppDatabase
import nova.agent.net.auth.ServerAuthClient
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.auth.TokenStore
import nova.agent.net.approval.ServerApprovalChannel
import nova.agent.net.definition.DefinitionClient
import nova.agent.net.http.ServerHttp
import nova.agent.net.journal.PendingPushQueue
import nova.agent.net.journal.RoomPendingPushQueue
import nova.agent.provider.OpenAICompatProvider
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * 手动 DI 容器（Application 持有；不引 Hilt/Koin）。
 * Compose 侧经 LocalAppContainer 取容器；业务数据一律走参数传递。
 *
 * 阶段3 起按 [DataSource] 构造演示/真实两套图（重启生效，FR11）：
 * settings/dataSourceBlocking 在启动期同步读一次单键（极小 IO）。
 */
class AppContainer(private val appContext: Context) {

    val applicationScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val themeStore: ThemeStore = ThemeStore(appContext)

    val settings: AppSettingsStore = AppSettingsStore(
        appContext,
        byokCipher = runCatching { KeystoreTokenCipher(KeystoreTokenStore.BYOK_ALIAS) }.getOrNull(),
    )

    val mode: DataSource = settings.dataSourceBlocking()

    // ---- 真实图组件（阶段3 逐步落位：Step3 appRepo → Step5 会话域 → Step7 FGS） ----

    /** Room（Android 框架 SQLite 驱动；JVM 测试用 inMemory，不走这里）。 */
    val db: AppDatabase by lazy {
        Room.databaseBuilder(appContext, AppDatabase::class.java, AppDatabase.NAME).build()
    }

    /** 令牌持久化：Keystore 加密 + DataStore（KeyStore 异常内部回落明文并打点）。 */
    val tokenStore: TokenStore by lazy { KeystoreTokenStore.fromContext(appContext) }

    /** 认证会话（真实图共享：appRepo/会话域/SSE 都从这里取令牌）。 */
    val authSession: ServerAuthSession by lazy {
        ServerAuthSession(tokenStore, clientFactory = { url -> ServerAuthClient(url) })
    }

    /** BYOK Provider 工厂（FR9）：三件未配置返回 null（LazyProvider 在首次推理时报错引导）。 */
    suspend fun makeProvider(): OpenAICompatProvider? =
        settings.byokConfig()?.let { OpenAICompatProvider(baseUrl = it.baseUrl, apiKey = it.apiKey, model = it.model) }

    /**
     * BYOK 连通测试：轻量 GET /models（对齐桌面 connectionTest——免计费只验证可达与密钥），8s 超时。
     * 返回 null = 通过；非 null = 失败文案。
     */
    suspend fun testByokConnection(): String? {
        val config = settings.byokConfig() ?: return "请先保存 BYOK 配置"
        return try {
            withContext(Dispatchers.IO) {
                val client = OkHttpClient.Builder()
                    .connectTimeout(8, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).build()
                val request = okhttp3.Request.Builder()
                    .url(config.baseUrl.trimEnd('/') + "/models")
                    .header("Authorization", "Bearer ${config.apiKey}")
                    .build()
                client.newCall(request).execute().use { resp ->
                    if (resp.isSuccessful) null else "HTTP ${resp.code}：${resp.message}"
                }
            }
        } catch (e: Exception) {
            "连接失败：${e.message ?: e.toString()}"
        }
    }

    // ---- 会话域（真实图，Step5） ----

    val registry: ConversationRegistry by lazy {
        ConversationRegistry(appContext.filesDir.resolve("conversations").toPath())
    }

    private val syncUrl: () -> String = { runBlocking { settings.serverUrl.first() } }

    val pendingQueue: PendingPushQueue by lazy { RoomPendingPushQueue(db.pendingPushDao()) }

    /** 审批中心（FR7）：pending 聚合 + 跨端 resolve。 */
    val approvalCenter: ApprovalCenter? =
        if (mode == DataSource.REAL) {
            ApprovalCenter(
                scope = applicationScope,
                registry = registry,
                makeChannel = { ServerApprovalChannel(ServerHttp(syncUrl()), authSession) },
            )
        } else null

    /** 全局 SSE 通道（FR6）：登录后常驻。 */
    val globalChannel: nova.agent.app.sync.GlobalChannel? =
        if (mode == DataSource.REAL) {
            nova.agent.app.sync.GlobalChannel(
                scope = applicationScope,
                baseUrl = syncUrl,
                httpFactory = { ServerHttp(it) },
                authSession = authSession,
                registry = registry,
                routeApprovalResolved = { conversationCoordinator.routeApprovalResolved(it) },
                onLeaseReleased = { conversationCoordinator.onLeaseReleased() },
                onApprovalRequested = { ev ->
                    approvalCenter?.refresh()
                    nova.agent.app.service.NovaNotifier.notifyApproval(appContext, ev, background = !appInForeground.value)
                },
            )
        } else null

    /** debug 演示旁路（demo 模式的 ChatSideChannels；真实模式下仅 DemoReplayBar 引用） */
    val demoTriggers = DemoTriggers()

    /** 会话切换信号：ChatViewModel 收集后整场重置（首屏历史经事件流重放）。 */
    val conversationSwitched = MutableSharedFlow<String>(extraBufferCapacity = 4)

    /** 会话打开入口（demo 模式为 null，UI 静默）。 */
    val conversationOpener: (suspend (projectId: String?, cid: String?) -> ConversationCoordinator.OpenOutcome)? =
        if (mode == DataSource.REAL) ({ projectId, cid -> conversationCoordinator.open(projectId, cid) }) else null

    val conversations: StateFlow<List<ConversationMeta>> =
        if (mode == DataSource.REAL) registry.conversations else MutableStateFlow(emptyList())

    val activeConversation: StateFlow<String?> =
        if (mode == DataSource.REAL) {
            kotlinx.coroutines.flow.MutableStateFlow<String?>(null).also { flow ->
                applicationScope.launch {
                    conversationCoordinator.active.collect { flow.value = it?.conversationId }
                }
            }
        } else MutableStateFlow(null)


    private suspend fun deviceNameOf(deviceId: String): String =
        runCatching { authSession.devices()?.firstOrNull { it.id == deviceId }?.name }.getOrNull()
            ?: ConversationRegistry.shortCode(deviceId)

    private val leaseCoordinator: LeaseCoordinator by lazy {
        LeaseCoordinator(
            scope = applicationScope,
            transport = LeaseClientTransport({ ServerHttp(it) }, authSession, baseUrlProvider = syncUrl),
            stopActiveRun = { coordinatorRef.get()?.stopAllRuns() },
            onNeedRelogin = { /* authSession 令牌已吊销 → 状态自动翻 NeedRelogin（登录门） */ },
            deviceNameOf = { deviceNameOf(it) },
        )
    }

    private val coordinatorRef = java.util.concurrent.atomic.AtomicReference<ConversationCoordinator?>()

    val conversationCoordinator: ConversationCoordinator by lazy {
        ConversationCoordinator(
            scope = applicationScope,
            registry = registry,
            leaseCoordinator = leaseCoordinator,
            baseUrl = syncUrl,
            httpFactory = { ServerHttp(it) },
            authSession = authSession,
            pendingQueue = pendingQueue,
            providerFactory = { makeProvider() },
            loadDefinition = {
                DefinitionClient(ServerHttp(syncUrl()), authSession, appContext.filesDir.resolve("definitions").toPath())
                    .resolve("novel", buildJsonObject { })
            },
        ).also { coordinatorRef.set(it) }
    }

    // ---- 仓库按数据源选型（FR11：重启生效） ----

    val appRepo: AppRepository = when (mode) {
        DataSource.DEMO -> DemoAppRepository(applicationScope)
        DataSource.REAL -> ServerAppRepository(
            scope = applicationScope,
            authSession = authSession,
            loadServerUrl = { settings.serverUrl.first() },
            saveServerUrl = { settings.setServerUrl(it) },
            approvalCenter = approvalCenter,
        )
    }

    init {
        if (mode == DataSource.REAL) {
            // debug BYOK 预填（local.properties nova.dev.byok.*；仅当未配置时落一次，不覆盖用户手填）
            if (BuildConfig.DEBUG &&
                BuildConfig.DEV_BYOK_URL.isNotBlank() && BuildConfig.DEV_BYOK_KEY.isNotBlank() && BuildConfig.DEV_BYOK_MODEL.isNotBlank()
            ) {
                applicationScope.launch {
                    if (settings.byokConfig() == null) {
                        settings.setByok(BuildConfig.DEV_BYOK_URL, BuildConfig.DEV_BYOK_KEY, BuildConfig.DEV_BYOK_MODEL)
                    }
                }
            }
            // GlobalChannel 生命周期 = 登录态（Online/Offline 常驻；NeedRelogin/Unconfigured 停）
            applicationScope.launch {
                (appRepo as? ServerAppRepository)?.auth?.collect { st ->
                    when (st) {
                        is nova.agent.app.data.AuthUiState.Online, nova.agent.app.data.AuthUiState.Offline,
                        nova.agent.app.data.AuthUiState.LoggingIn,
                        -> globalChannel?.start()
                        else -> kotlinx.coroutines.runBlocking { globalChannel?.stop() }
                    }
                }
            }
            // 登录后拉一次审批中心聚合（会话发现由 GlobalChannel 持续登记）
            applicationScope.launch {
                (appRepo as? ServerAppRepository)?.auth?.collect { st ->
                    if (st is nova.agent.app.data.AuthUiState.Online) approvalCenter?.refresh()
                }
            }
            // FGS 存活谓词 → service 启停（START 仅前台窗口内发起——Android 12+ 后台启动限制；
            // 后台期间谓词变真不启动，进程未冻结前工作照常，回前台 ON_START 补启）
            applicationScope.launch {
                conversationCoordinator.fgsRequired.collect { required ->
                    nova.agent.app.di.D { "FGS required=$required fg=${appInForeground.value}" }
                    runCatching {
                        if (required && appInForeground.value) {
                            nova.agent.app.service.NovaForegroundService.start(appContext)
                        } else if (!required) {
                            nova.agent.app.service.NovaForegroundService.stop(appContext)
                        }
                    }
                }
            }
        }
    }

    // ---- 前台/深链（MainActivity 生命周期桥，FR8/§1.2-⑨） ----

    val appInForeground = MutableStateFlow(false)

    /** 通知深链路由（审批通知 → 审批中心；MainScaffold 消费后清空）。 */
    val pendingRoute = MutableStateFlow<nova.agent.app.ui.nav.Screen?>(null)

    /** ON_START：审批中心聚合刷新 + FGS 补启（谓词观察器在后台窗口错过变真时）。 */
    fun onAppForeground() {
        if (mode != DataSource.REAL) return
        approvalCenter?.refresh()
        if (conversationCoordinator.fgsRequired.value) {
            runCatching { nova.agent.app.service.NovaForegroundService.start(appContext) }
        }
    }

    /** 阶段2 = FakeChatRepository 脚本回放；阶段3 Step5 换 RealChatRepository（接口不变） */
    val chatRepo: ChatRepository = when (mode) {
        DataSource.DEMO -> FakeChatRepository(applicationScope)
        DataSource.REAL -> RealChatRepository(conversationCoordinator)
    }

    /** 聊天旁路通道（ChatSideChannels）：demo=DemoTriggers，real=ConversationCoordinator。 */
    val chatChannels: ChatSideChannels = when (mode) {
        DataSource.DEMO -> demoTriggers
        DataSource.REAL -> conversationCoordinator
    }
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

/** 覆盖层视觉验收的触发源（chat VM 收集）；演示模式下的 ChatSideChannels 实现 */
class DemoTriggers : nova.agent.app.data.ChatSideChannels {
    private val _oneShots = MutableSharedFlow<ChatOneShot>(extraBufferCapacity = 8)
    override val oneShots: SharedFlow<ChatOneShot> = _oneShots

    private val _demoEvents = MutableSharedFlow<DemoSignal>(extraBufferCapacity = 8)
    val demoEvents: SharedFlow<DemoSignal> = _demoEvents

    private val _lease = MutableStateFlow<ReadOnlyLease?>(null)
    override val lease: StateFlow<ReadOnlyLease?> = _lease

    override val pills: SharedFlow<String> = MutableSharedFlow(extraBufferCapacity = 8)

    /** demo 接续：直接弹冲突框（真实实现走 LeaseCoordinator） */
    override suspend fun resumeLease() {
        val holder = _lease.value?.deviceName ?: return
        _oneShots.tryEmit(ChatOneShot.Conflict409(holder))
    }

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
