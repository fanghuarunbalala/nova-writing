package nova.agent.app

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.outlined.Notifications
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
                    onDisconnect = { container.demoTriggers.disconnect() },
                    onLease = {
                        if (container.demoTriggers.lease.value == null) container.demoTriggers.readonlyLease()
                        else container.demoTriggers.clearLease()
                    },
                )
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
    val approvals by appViewModel.approvals.collectAsStateWithLifecycle()
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
                Screen.Chat -> ChatBase(chatViewModel, approvals.size, currentProject, sheetState) {
                    scope.launch { drawerState.open() }
                }
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
    approvalCount: Int,
    currentProject: CloudProject,
    sheetState: androidx.compose.material3.SheetState,
    onOpenDrawer: () -> Unit,
) {
    val palette = LocalNovaPalette.current
    val scope = rememberCoroutineScope()

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
            ContentSheet(currentProject, onExpand = { scope.launch { sheetState.expand() } })
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // 顶栏（demo --topbar-h 56dp）
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
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(currentProject.name, style = NovaTypography.titleSmall)
                    Text(
                        currentProject.progress,
                        style = NovaText.mono12.copy(color = palette.muted, fontSize = 11.sp),
                    )
                }
                Box {
                    IconButton(onClick = { /* 审批中心入口由抽屉/路由承担，顶栏铃铛留演示位 */ }) {
                        Icon(Icons.Outlined.Notifications, contentDescription = "审批中心", tint = palette.fg)
                    }
                    if (approvalCount > 0) {
                        Box(
                            Modifier
                                .align(Alignment.TopEnd)
                                .padding(top = 8.dp, end = 8.dp)
                                .size(16.dp)
                                .background(palette.warn, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(approvalCount.toString(), color = palette.surface, fontSize = 10.sp)
                        }
                    }
                }
                Spacer(Modifier.width(8.dp))
            }
            ChatScreen(vm = chatViewModel)
        }
    }
}
