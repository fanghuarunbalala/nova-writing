package nova.agent.app

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.rememberStandardBottomSheetState
import androidx.compose.material3.SheetValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import nova.agent.app.data.AuthUiState
import nova.agent.app.data.CloudProject
import nova.agent.app.di.AppContainer
import nova.agent.app.ui.chat.ChatScreen
import nova.agent.app.ui.content.ContentSheet
import nova.agent.app.ui.content.ContentSheetPeekHeight
import nova.agent.app.ui.drawer.AppDrawer
import nova.agent.app.ui.login.LoginScreen
import nova.agent.app.ui.nav.AppNavState
import nova.agent.app.ui.nav.BackTarget
import nova.agent.app.ui.nav.Screen
import nova.agent.app.ui.nav.backTarget
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTheme
import nova.agent.app.ui.theme.NovaThemeKind
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.vm.AppViewModel
import nova.agent.app.ui.vm.ChatViewModel

/** 应用根：主题 → 登录门 → 主脚手架（v5 导航）；debug 悬演示浮条 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun NovaApp(container: AppContainer) {
    val appViewModel: AppViewModel = viewModel(factory = AppViewModel.factory(container))
    val theme by appViewModel.theme.collectAsStateWithLifecycle()

    NovaTheme(theme) {
        // 全局 snackbar 宿主（PRD FR8）：登录门/主界面/演示浮条都在其内
        nova.agent.app.ui.common.FeedbackHost {
            val auth by appViewModel.auth.collectAsStateWithLifecycle()
            // 键盘弹起时藏掉演示浮条（避免盖住输入区）
            val imeVisible = WindowInsets.isImeVisible
            Box(Modifier.fillMaxSize()) {
                when (auth) {
                    AuthUiState.Unconfigured, AuthUiState.NeedRelogin -> LoginScreen(appViewModel)
                    else -> MainScaffold(container, appViewModel)
                }
                if (BuildConfig.DEBUG && !imeVisible && auth !is AuthUiState.Unconfigured && auth !is AuthUiState.NeedRelogin) {
                    val leaseActive by container.demoTriggers.lease.collectAsStateWithLifecycle()
                    nova.agent.app.ui.demo.DemoReplayBar(
                        theme = theme,
                        leaseActive = leaseActive != null,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .navigationBarsPadding()
                            .padding(bottom = 108.dp),
                        onCycleTheme = {
                            val next = NovaThemeKind.entries[(NovaThemeKind.entries.indexOf(theme) + 1) % NovaThemeKind.entries.size]
                            appViewModel.setTheme(next)
                        },
                        onConflict = { container.demoTriggers.conflict() },
                        onDisconnect = {
                            appViewModel.demoGoOffline()
                            container.demoTriggers.disconnect()
                        },
                        onLease = {
                            if (container.demoTriggers.lease.value == null) container.demoTriggers.readonlyLease()
                            else container.demoTriggers.clearLease()
                        },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainScaffold(container: AppContainer, appViewModel: AppViewModel) {
    val palette = LocalNovaPalette.current
    val chatViewModel: ChatViewModel = viewModel(factory = ChatViewModel.factory(container))
    val scope = rememberCoroutineScope()
    val nav = remember { AppNavState() }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val sheetState = rememberStandardBottomSheetState(initialValue = SheetValue.PartiallyExpanded)
    val projects by appViewModel.projects.collectAsStateWithLifecycle()
    val currentId by appViewModel.currentProjectId.collectAsStateWithLifecycle()
    val currentProject = projects.firstOrNull { it.id == currentId } ?: CloudProject("p-0", "—", "—", 0, "—")

    // 返回键优先级（单一 BackHandler + 纯函数判定）：sheet > 抽屉 > 路由栈 > 退出
    val sheetNotCollapsed = sheetState.currentValue != SheetValue.PartiallyExpanded ||
        sheetState.targetValue != SheetValue.PartiallyExpanded
    val backAim = backTarget(sheetNotCollapsed, drawerState.isOpen, nav.stack.size)
    BackHandler(enabled = backAim != null) {
        when (backAim) {
            BackTarget.CLOSE_SHEET -> scope.launch { sheetState.partialExpand() }
            BackTarget.CLOSE_DRAWER -> scope.launch { drawerState.close() }
            BackTarget.POP_ROUTE -> nav.pop()
            null -> Unit
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = nav.stack.isEmpty() && !sheetNotCollapsed,
        drawerContent = {
            AppDrawer(
                vm = appViewModel,
                demoTriggers = container.demoTriggers,
                onNavigate = { screen ->
                    scope.launch { drawerState.close() }
                    nav.push(screen)
                },
                onOpenContentSheet = {
                    scope.launch {
                        drawerState.close()
                        sheetState.expand()
                    }
                },
                onLogout = {
                    scope.launch { drawerState.close() }
                    appViewModel.logout()
                    nav.reset()
                },
            )
        },
    ) {
        Crossfade(targetState = nav.current, animationSpec = tween(NovaDimens.DUR_BASE), label = "route") { screen ->
            when (screen) {
                Screen.Chat -> ChatBase(
                    chatViewModel = chatViewModel,
                    currentProject = currentProject,
                    auth = appViewModel.auth.collectAsStateWithLifecycle().value,
                    sheetState = sheetState,
                    onOpenDrawer = { scope.launch { drawerState.open() } },
                    onOpenSettings = { nav.push(Screen.Settings) },
                    onWaitRecover = { appViewModel.demoWaitRecover { chatViewModel.onConnectionRestored() } },
                )
                Screen.Settings -> nova.agent.app.ui.settings.SettingsScreen(
                    vm = appViewModel,
                    onNavigate = { nav.push(it) },
                    onLogout = {
                        appViewModel.logout()
                        nav.reset()
                    },
                )
                Screen.Devices -> nova.agent.app.ui.settings.DevicesScreen(vm = appViewModel, onBack = { nav.pop() })
                Screen.ApprovalCenter -> nova.agent.app.ui.approval.ApprovalCenterScreen(vm = appViewModel, onBack = { nav.pop() })
                Screen.Library -> nova.agent.app.ui.library.LibraryScreen(onBack = { nav.pop() })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun ChatBase(
    chatViewModel: ChatViewModel,
    currentProject: CloudProject,
    auth: AuthUiState,
    sheetState: androidx.compose.material3.SheetState,
    onOpenDrawer: () -> Unit,
    onOpenSettings: () -> Unit,
    onWaitRecover: () -> Unit,
) {
    val palette = LocalNovaPalette.current
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    val feedback = nova.agent.app.ui.common.rememberFeedback()
    // 内容 sheet 的 tab 受控状态：实体胶囊（entChip）点击可指定跳转 tab（PRD FR2.2）
    var contentTab by rememberSaveable { mutableIntStateOf(0) }
    var menuOpen by remember { mutableStateOf(false) }

    // 键盘弹起时整体收掉内容 sheet：否则 peek 高度 + 导航栏内边距会垫在输入法与输入条之间
    // （真机实测的大段空白，PRD 开放问题④的落地）；键盘收起后回落 peek。
    val imeVisible = WindowInsets.isImeVisible
    LaunchedEffect(imeVisible) {
        if (imeVisible) sheetState.hide() else sheetState.partialExpand()
    }

    BottomSheetScaffold(
        scaffoldState = androidx.compose.material3.rememberBottomSheetScaffoldState(bottomSheetState = sheetState),
        containerColor = palette.bg,
        sheetContainerColor = palette.surface,
        sheetPeekHeight = ContentSheetPeekHeight,
        sheetShape = RoundedCornerShape(topStart = NovaDimens.radiusSheet, topEnd = NovaDimens.radiusSheet),
        sheetDragHandle = null,
        sheetContent = {
            ContentSheet(
                project = currentProject,
                tab = contentTab,
                onTabChange = { contentTab = it },
                onExpand = { scope.launch { sheetState.expand() } },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // 顶栏（demo L1113-1140）：☰ + 左对齐双行标题 + 连接胶囊 + ⋯ 菜单
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(palette.bg)
                    .statusBarsPadding()
                    .height(NovaDimens.topbarHeight)
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onOpenDrawer) {
                    Icon(Icons.Outlined.Menu, contentDescription = "打开侧栏", tint = palette.fg)
                }
                Column(Modifier.weight(1f)) {
                    Text(currentProject.name, style = NovaTypography.titleSmall)
                    Text(
                        chatViewModel.sessionSubtitle,
                        style = NovaText.mono12.copy(color = palette.muted, fontSize = 11.sp),
                    )
                }
                ConnChip(auth = auth, onClick = onOpenSettings)
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = "会话菜单", tint = palette.fg)
                    }
                    androidx.compose.material3.DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        androidx.compose.material3.DropdownMenuItem(
                            text = {
                                Column {
                                    Text("会话信息", style = NovaTypography.bodyMedium)
                                    Text(chatViewModel.sessionMeta, style = NovaText.mono11.copy(color = palette.faint))
                                }
                            },
                            onClick = {
                                menuOpen = false
                                feedback("会话 conv_2 · run #47 · 模式 需审核 · journal seq 213")
                            },
                        )
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text("导出本轮 Markdown", style = NovaTypography.bodyMedium) },
                            onClick = {
                                menuOpen = false
                                exportCurrentRound(context, chatViewModel.uiState.value.items)
                                feedback("已导出 Markdown：长夜余烬-追逃段-第3轮.md（分享面板 demo）")
                            },
                        )
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text("清空上下文 · 新一轮", style = NovaTypography.bodyMedium) },
                            onClick = {
                                menuOpen = false
                                chatViewModel.clearContext()
                            },
                        )
                    }
                }
                Spacer(Modifier.width(8.dp))
            }
            ChatScreen(
                vm = chatViewModel,
                onOpenEntity = { tab ->
                    contentTab = tab
                    scope.launch { sheetState.expand() }
                },
                onWaitRecover = onWaitRecover,
            )
        }
    }
}

/** 连接状态胶囊（demo connChip L1117-1119）：状态点 + 文案；点击进设置页 */
@Composable
private fun ConnChip(auth: AuthUiState, onClick: () -> Unit) {
    val palette = LocalNovaPalette.current
    val (dot, label) = when (auth) {
        is AuthUiState.Online -> palette.success to "在线"
        AuthUiState.Offline -> palette.danger to "离线"
        AuthUiState.NeedRelogin -> palette.warn to "需重登"
        AuthUiState.LoggingIn -> palette.warn to "连接中"
        AuthUiState.Unconfigured -> palette.faint to "未配置"
    }
    Row(
        Modifier
            .background(palette.surface2, RoundedCornerShape(99.dp))
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(Modifier.size(6.dp).background(dot, CircleShape))
        Text(label, style = NovaTypography.labelSmall)
    }
}

/** 导出本轮 Markdown（demo ⋯ 菜单：本地拼接 + 系统分享面板，不涉网络） */
private fun exportCurrentRound(context: android.content.Context, items: List<nova.agent.app.data.ChatItem>) {
    val md = buildString {
        appendLine("# 长夜余烬 · 追逃段 · 第 3 轮")
        appendLine()
        items.forEach { item ->
            when (item) {
                is nova.agent.app.data.ChatItem.RoundLabel -> {
                    appendLine(); appendLine("## ${item.text}"); appendLine()
                }
                is nova.agent.app.data.ChatItem.UserMsg -> appendLine("**我**：${item.text}\n")
                is nova.agent.app.data.ChatItem.AssistantMsg -> appendLine("${item.text}\n")
                is nova.agent.app.data.ChatItem.ToolLine -> appendLine("- `${item.name}` ${item.summary}")
                else -> Unit
            }
        }
    }
    val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
        type = "text/markdown"
        putExtra(android.content.Intent.EXTRA_TEXT, md)
        putExtra(android.content.Intent.EXTRA_TITLE, "长夜余烬-追逃段-第3轮.md")
    }
    context.startActivity(android.content.Intent.createChooser(send, null))
}
