package nova.agent.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DevicesOther
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import nova.agent.app.data.AuthUiState
import nova.agent.app.ui.nav.Screen
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaThemeKind
import nova.agent.app.ui.theme.NovaTypography

/** 设置（PRD FR8）：连接 Hero / 设备管理入口 / BYOK（内存）/ 主题 2×2 / 关于 */
@Composable
fun SettingsScreen(vm: nova.agent.app.ui.vm.AppViewModel, onNavigate: (Screen) -> Unit, onLogout: () -> Unit) {
    val palette = LocalNovaPalette.current
    val auth by vm.auth.collectAsStateWithLifecycle()
    val theme by vm.theme.collectAsStateWithLifecycle()
    var baseUrl by rememberSaveable { mutableStateOf("") }
    var apiKey by rememberSaveable { mutableStateOf("") }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
    ) {
        // ---- 连接 Hero ----
        Column(
            Modifier
                .fillMaxWidth()
                .padding(top = 8.dp)
                .background(palette.surface, RoundedCornerShape(NovaDimens.radiusLg))
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            val online = auth as? AuthUiState.Online
            val (icon, tint, label, sub) = when {
                online != null -> SettingsHero(Icons.Rounded.CloudDone, palette.success, "已连接", "${online.username}@${online.serverUrl}")
                auth == AuthUiState.Offline -> SettingsHero(Icons.Rounded.CloudOff, palette.danger, "离线", "点击重连（demo）")
                auth == AuthUiState.NeedRelogin -> SettingsHero(Icons.Rounded.CloudOff, palette.warn, "需要重新登录", "令牌已过期")
                else -> SettingsHero(Icons.Rounded.CloudOff, palette.faint, "未配置", "登录后开始使用")
            }
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(34.dp))
            Text(label, style = NovaTypography.titleMedium, modifier = Modifier.padding(top = 8.dp))
            Text(sub, style = NovaText.mono12.copy(color = palette.muted), modifier = Modifier.padding(top = 2.dp))
        }

        SectionLabel("设备与接入")
        SettingEntry(Icons.Outlined.DevicesOther, "设备管理", "3 台设备在线记录 · 踢出与令牌吊销") { onNavigate(Screen.Devices) }

        SectionLabel("自带密钥（BYOK）")
        Column(
            Modifier
                .fillMaxWidth()
                .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(value = baseUrl, onValueChange = { baseUrl = it }, label = { Text("Provider Base URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = apiKey, onValueChange = { apiKey = it }, label = { Text("API Key") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Text(
                "阶段2 仅内存暂存；Keystore 加密与连通性测试在阶段 3/4。Agent 策略沿用桌面端配置。",
                style = NovaTypography.labelSmall.copy(color = palette.faint),
            )
        }

        SectionLabel("主题")
        Column(
            Modifier
                .fillMaxWidth()
                .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                .padding(12.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                NovaThemeKind.entries.take(2).forEach { kind ->
                    ThemeCard(kind, selected = theme == kind, modifier = Modifier.weight(1f)) { vm.setTheme(kind) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 10.dp)) {
                NovaThemeKind.entries.takeLast(2).forEach { kind ->
                    ThemeCard(kind, selected = theme == kind, modifier = Modifier.weight(1f)) { vm.setTheme(kind) }
                }
            }
        }

        SectionLabel("关于")
        Column(
            Modifier
                .fillMaxWidth()
                .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                .padding(12.dp),
        ) {
            Text("nova · 0.2.0-stage2", style = NovaTypography.bodyMedium)
            Text("定义包 1.6.0 · 协议 cloud-project-api v1.1", style = NovaText.mono12.copy(color = palette.muted))
        }

        // 登出
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = 18.dp, bottom = 32.dp)
                .height(48.dp)
                .background(palette.danger12, RoundedCornerShape(99.dp))
                .clickable { onLogout() }
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Rounded.Logout, contentDescription = null, tint = palette.danger, modifier = Modifier.size(18.dp))
            Text("退出登录", color = palette.danger, style = NovaTypography.bodyLarge.copy(fontWeight = FwMedium))
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    val palette = LocalNovaPalette.current
    Text(
        text,
        style = NovaTypography.labelSmall.copy(color = palette.faint),
        modifier = Modifier.padding(start = 4.dp, top = 22.dp, bottom = 8.dp),
    )
}

private data class SettingsHero(
    val icon: ImageVector,
    val tint: androidx.compose.ui.graphics.Color,
    val label: String,
    val sub: String,
)

@Composable
private fun SettingEntry(icon: ImageVector, title: String, sub: String, onClick: () -> Unit) {
    val palette = LocalNovaPalette.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = palette.accent, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = NovaTypography.bodyLarge)
            Text(sub, style = NovaTypography.labelSmall.copy(color = palette.faint))
        }
        Text("›", color = palette.faint)
    }
}

/** 主题卡：三色块预览（bg/surface/accent）+ 名称；点击即时切换 */
@Composable
private fun ThemeCard(kind: NovaThemeKind, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val palette = LocalNovaPalette.current
    val preview = kind.palette
    Column(
        modifier
            .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
            .border(
                width = if (selected) 1.5.dp else 1.dp,
                color = if (selected) palette.accent else palette.border,
                shape = RoundedCornerShape(NovaDimens.radiusMd),
            )
            .clickable { onClick() }
            .padding(10.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(Modifier.size(18.dp).background(preview.bg, RoundedCornerShape(4.dp)).border(0.5.dp, palette.border, RoundedCornerShape(4.dp)))
            Box(Modifier.size(18.dp).background(preview.surface, RoundedCornerShape(4.dp)).border(0.5.dp, palette.border, RoundedCornerShape(4.dp)))
            Box(Modifier.size(18.dp).background(preview.accent, RoundedCornerShape(4.dp)))
        }
        Text(
            kind.label,
            style = NovaTypography.labelMedium.copy(color = if (selected) palette.accent else palette.muted),
            modifier = Modifier.padding(top = 8.dp),
        )
        Spacer(Modifier.height(0.dp))
    }
}
