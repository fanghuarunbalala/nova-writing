package nova.agent.app.ui.drawer

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CollectionsBookmark
import androidx.compose.material.icons.outlined.DevicesOther
import androidx.compose.material.icons.outlined.FactCheck
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import nova.agent.app.BuildConfig
import nova.agent.app.data.CloudProject
import nova.agent.app.di.DemoTriggers
import nova.agent.app.ui.demo.restartApp
import nova.agent.app.ui.nav.Screen
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.vm.AppViewModel

/**
 * 侧边抽屉（demo --drawer-w 306dp）：当前项目卡 → 云端项目 → 审批中心/书库/设置 → 登出。
 * 点击 = 切换项目；+ = 新建命名；长按行内删除 = 软删二次确认。
 */
@Composable
fun AppDrawer(
    vm: AppViewModel,
    demoTriggers: DemoTriggers,
    onNavigate: (Screen) -> Unit,
    onOpenContentSheet: () -> Unit,
    onLogout: () -> Unit,
) {
    val palette = LocalNovaPalette.current
    val context = LocalContext.current
    val feedback = nova.agent.app.ui.common.rememberFeedback()
    val projects by vm.projects.collectAsStateWithLifecycle()
    val currentId by vm.currentProjectId.collectAsStateWithLifecycle()
    val approvalCount by vm.approvals.collectAsStateWithLifecycle()
    val devices by vm.devices.collectAsStateWithLifecycle()
    val current = projects.firstOrNull { it.id == currentId }

    var createOpen by rememberSaveable { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<CloudProject?>(null) }

    ModalDrawerSheet(
        drawerContainerColor = palette.surface,
        drawerShape = RoundedCornerShape(0.dp),
        modifier = Modifier.width(NovaDimens.drawerWidth),
    ) {
        Column(
            Modifier
                .statusBarsPadding()
                .padding(bottom = 16.dp)
        ) {
            // ---- 当前项目卡 ----
            Column(
                Modifier
                    .padding(start = 18.dp, end = 12.dp, top = 18.dp)
                    .fillMaxWidth()
                    .background(palette.accent11, RoundedCornerShape(NovaDimens.radiusMd))
                    .clickable(onClick = onOpenContentSheet)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.MenuBook, null, tint = palette.accent, modifier = Modifier.size(18.dp))
                    Text(
                        current?.name ?: "未打开项目",
                        style = NovaTypography.titleSmall,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
                Text(
                    // demo 副行（L1611-1619）：「第 2 章 · 追逃段 · 18.4 万字」
                    "${current?.updatedAtLabel ?: "—"} · %.1f 万字".format((current?.words ?: 0) / 10_000f),
                    style = NovaText.mono12.copy(color = palette.muted),
                    modifier = Modifier.padding(start = 26.dp, top = 4.dp),
                )
            }

            Text(
                "云端项目",
                style = NovaTypography.labelSmall.copy(color = palette.faint),
                modifier = Modifier.padding(start = 18.dp, top = 22.dp, bottom = 4.dp),
            )
            projects.forEach { p ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { vm.switchProject(p.id) }
                        .padding(start = 18.dp, end = 8.dp, top = 4.dp, bottom = 4.dp)
                        .height(44.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(p.name, style = NovaTypography.bodyMedium, fontWeight = if (p.id == currentId) FwMedium else FontWeight.Normal)
                        Text(p.updatedAtLabel, style = NovaTypography.labelSmall.copy(color = palette.faint))
                    }
                    if (p.id == currentId) {
                        Box(
                            Modifier
                                .size(6.dp)
                                .background(palette.accent, CircleShape),
                        )
                    } else {
                        Icon(
                            Icons.Outlined.DeleteOutline,
                            contentDescription = "删除 ${p.name}",
                            tint = palette.faint,
                            modifier = Modifier
                                .size(20.dp)
                                .clip(CircleShape)
                                .clickable { deleteTarget = p }
                                .padding(3.dp),
                        )
                    }
                }
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { createOpen = true }
                    .padding(start = 18.dp, top = 6.dp)
                    .height(44.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Add, null, tint = palette.muted, modifier = Modifier.size(18.dp))
                Text("新建项目", style = NovaTypography.bodyMedium.copy(color = palette.muted), modifier = Modifier.padding(start = 10.dp))
            }

            HorizontalDivider(Modifier.padding(horizontal = 18.dp, vertical = 14.dp), color = palette.border)

            DrawerEntry(Icons.Outlined.FactCheck, "审批中心", badge = approvalCount.size) { onNavigate(Screen.ApprovalCenter) }
            DrawerEntry(Icons.Outlined.CollectionsBookmark, "书库") { onNavigate(Screen.Library) }
            DrawerEntry(Icons.Outlined.Settings, "设置", sub = "server · BYOK") { onNavigate(Screen.Settings) }

            // ---- 账号组（demo L1621-1623：设备管理指向设置页） ----
            HorizontalDivider(Modifier.padding(horizontal = 18.dp, vertical = 10.dp), color = palette.border)
            DrawerEntry(Icons.Outlined.DevicesOther, "设备管理", sub = "${devices.size} 台") {
                feedback("设备管理在设置页 · 「服务器」分组内")
            }

            // ---- 演示控制（仅 debug；覆盖层/只读租约的入口在这里最易发现） ----
            if (BuildConfig.DEBUG) {
                HorizontalDivider(Modifier.padding(horizontal = 18.dp, vertical = 10.dp), color = palette.border)
                Text(
                    "演示控制（仅 debug 构建）",
                    style = NovaTypography.labelSmall.copy(color = palette.faint),
                    modifier = Modifier.padding(start = 18.dp),
                )
                val leaseActive by demoTriggers.lease.collectAsStateWithLifecycle()
                Text(
                    if (leaseActive == null) "只读租约：顶部出现他端写作横幅（接续 → 409）" else "只读态生效中：清除后恢复正常",
                    style = NovaTypography.labelSmall.copy(color = if (leaseActive == null) palette.faint else palette.warn),
                    modifier = Modifier.padding(start = 18.dp, top = 2.dp),
                )
                Row(
                    Modifier.padding(start = 18.dp, top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    DemoTriggerChip("409 冲突") { demoTriggers.conflict() }
                    DemoTriggerChip("SSE 断线") {
                        vm.demoGoOffline()
                        demoTriggers.disconnect()
                    }
                    DemoTriggerChip(if (leaseActive == null) "注入只读租约" else "清除只读") {
                        if (leaseActive == null) demoTriggers.readonlyLease() else demoTriggers.clearLease()
                    }
                }
                Row(
                    Modifier.padding(start = 18.dp, top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    DemoTriggerChip("连接四态循环") { vm.demoCycleConnection() }
                    DemoTriggerChip("审批超时速演") { demoTriggers.speedUpApproval() }
                    DemoTriggerChip("生成失败注入") { demoTriggers.failGeneration() }
                }
                Row(Modifier.padding(start = 18.dp, top = 6.dp)) {
                    DemoTriggerChip("重置演示（进程重启）") { restartApp(context) }
                }
            }

            Spacer(Modifier.weight(1f))
            DrawerEntry(Icons.Outlined.Logout, "退出登录", tint = palette.danger) {
                feedback("已登出——双令牌已吊销，本地数据保留")
                onLogout()
            }
        }
    }

    if (createOpen) {
        var name by rememberSaveable { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { createOpen = false },
            containerColor = palette.surface,
            title = { Text("新建云端项目", style = NovaTypography.titleSmall) },
            text = {
                OutlinedTextField(value = name, onValueChange = { name = it }, singleLine = true, label = { Text("书名") })
            },
            confirmButton = {
                TextButton(onClick = {
                    if (name.isNotBlank()) vm.createProject(name.trim())
                    createOpen = false
                }) { Text("创建", color = palette.accent) }
            },
            dismissButton = { TextButton(onClick = { createOpen = false }) { Text("取消", color = palette.muted) } },
        )
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            containerColor = palette.surface,
            title = { Text("删除「${target.name}」？", style = NovaTypography.titleSmall) },
            text = { Text("云端软删除，30 天内可从回收站恢复（demo）。", style = NovaTypography.bodySmall) },
            confirmButton = {
                TextButton(onClick = {
                    vm.deleteProject(target.id)
                    deleteTarget = null
                }) { Text("删除", color = palette.danger) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("取消", color = palette.muted) } },
        )
    }
}

@Composable
private fun DemoTriggerChip(label: String, onClick: () -> Unit) {
    val palette = LocalNovaPalette.current
    Text(
        label,
        style = NovaTypography.labelSmall.copy(color = palette.muted),
        modifier = Modifier
            .background(palette.surface2, RoundedCornerShape(99.dp))
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

@Composable
private fun DrawerEntry(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    sub: String? = null,
    badge: Int? = null,
    tint: androidx.compose.ui.graphics.Color = androidx.compose.material3.MaterialTheme.colorScheme.onSurface,
    onClick: () -> Unit,
) {
    val palette = LocalNovaPalette.current
    Row(
        Modifier
            .fillMaxWidth()
            .height(NovaDimens.touchMin)
            .padding(start = 18.dp)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f)) {
            Text(label, style = NovaTypography.bodyLarge)
            if (sub != null) {
                Text(sub, style = NovaTypography.labelSmall.copy(color = palette.faint))
            }
        }
        if (badge != null && badge > 0) {
            Box(
                Modifier
                    .size(18.dp)
                    .background(palette.warnBg, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    badge.toString(),
                    color = palette.warn,
                    fontSize = 10.5.sp,
                    fontWeight = FwMedium,
                )
            }
        }
    }
}
