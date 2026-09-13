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

/** 设置（PRD FR8 + 阶段2补 FR1）：连接 Hero / 服务器组 / 设备管理入口 / BYOK（内存+只读行）/ 主题 2×2 / 关于 */
@Composable
fun SettingsScreen(vm: nova.agent.app.ui.vm.AppViewModel, onNavigate: (Screen) -> Unit, onLogout: () -> Unit) {
    val palette = LocalNovaPalette.current
    val auth by vm.auth.collectAsStateWithLifecycle()
    val theme by vm.theme.collectAsStateWithLifecycle()
    val feedback = nova.agent.app.ui.common.rememberFeedback()
    var baseUrl by rememberSaveable { mutableStateOf("https://api.deepseek.com/v1") }
    var apiKey by rememberSaveable { mutableStateOf("sk-••••••••••••3a7f") }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
    ) {
        // ---- 连接 Hero（demo connHero L1479-1486：四态文案 + 右侧登出） ----
        val online = auth as? AuthUiState.Online
        val (icon, tint, label, sub) = when {
            online != null -> SettingsHero(
                Icons.Rounded.CloudDone, palette.success,
                "在线 · ${online.username}@${online.serverUrl.removePrefix("https://")}",
                "${online.serverUrl} · 设备 Pixel 9 · 已连接 2h",
            )
            auth == AuthUiState.Offline -> SettingsHero(
                Icons.Rounded.CloudOff, palette.danger, "离线 · 缓存可读 · 排队中",
                "server 不可达 · 重连退避中（1/2/5/10s）· 本地缓存可读",
            )
            auth == AuthUiState.NeedRelogin -> SettingsHero(
                Icons.Rounded.CloudOff, palette.warn, "需要重新登录 · 令牌复用",
                "refresh token 复用 → 会话族已吊销（全端重登）",
            )
            else -> SettingsHero(
                Icons.Rounded.CloudOff, palette.faint, "未配置 · 登录后启用",
                "纯云端架构：填写服务器地址并登录（唯一入口）",
            )
        }
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = 8.dp)
                .background(palette.surface, RoundedCornerShape(NovaDimens.radiusLg))
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(34.dp))
                Text(label, style = NovaTypography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                Text(sub, style = NovaText.mono12.copy(color = palette.muted), modifier = Modifier.padding(top = 2.dp))
            }
            if (online != null) {
                Text(
                    "登出",
                    style = NovaTypography.labelMedium,
                    color = palette.danger,
                    modifier = Modifier
                        .clickable { onLogout() }
                        .background(palette.danger12, RoundedCornerShape(99.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }

        // ---- 服务器组（demo L1489-1499） ----
        SectionLabel("服务器")
        Column(
            Modifier
                .fillMaxWidth()
                .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SettingStaticRow(
                "服务器地址",
                (online?.serverUrl ?: nova.agent.app.data.AppRepository.DEMO_SERVER),
            )
            if (auth == AuthUiState.NeedRelogin) {
                SettingStaticRow("重新登录", "令牌复用检测触发——需重新登录", chip = "需要") { onLogout() }
            }
        }

        SectionLabel("设备管理 · 3 台在线会话")
        SettingEntry(Icons.Outlined.DevicesOther, "设备管理", "踢出 = 吊销该端 refresh token") { onNavigate(Screen.Devices) }

        // ---- BYOK（demo L1525-1549：可编辑两项 + 三个只读展示行） ----
        SectionLabel("模型（BYOK · 自带密钥）")
        Column(
            Modifier
                .fillMaxWidth()
                .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(value = baseUrl, onValueChange = { baseUrl = it }, label = { Text("Provider Base URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                value = apiKey, onValueChange = { apiKey = it }, label = { Text("API Key") }, singleLine = true,
                supportingText = { Text("Keystore", style = NovaText.mono11.copy(color = palette.faint)) },
                modifier = Modifier.fillMaxWidth(),
            )
            SettingStaticRow("模型", "deepseek-chat · timeout 60000ms")
            SettingStaticRow("连接测试", "上次成功 · 5 分钟前 · 421ms", chip = "可用")
            SettingStaticRow("Agent 策略（只读）", "温度 0.7 · 压缩 T1 0.7 / T2 摘要 2048", chip = "桌面端配置") {
                feedback("Agent 采样与压缩阈值在桌面端配置——移动端只读")
            }
            Text(
                "阶段2 仅内存暂存；Keystore 加密与连通性测试在阶段 3/4。",
                style = NovaTypography.labelSmall.copy(color = palette.faint),
            )
        }

        SectionLabel("外观")
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
            Text("Nova Writing Android · 0.2.0-stage2", style = NovaTypography.bodyMedium)
            Text("定义包 1.6.0 · 协议 cloud-project-api v1.1", style = NovaText.mono12.copy(color = palette.muted))
            Text(
                "碎片时间的补充端 · 云端项目 · BYOK · 审批异步化",
                style = NovaText.kai.copy(color = palette.faint),
                modifier = Modifier.padding(top = 4.dp),
            )
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

/** 只读展示行（demo 设置页的静态值行）：label 左、值右（可带 chip、可点） */
@Composable
private fun SettingStaticRow(label: String, value: String, chip: String? = null, onClick: (() -> Unit)? = null) {
    val palette = LocalNovaPalette.current
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier)
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(label, style = NovaTypography.bodyMedium)
        Text(
            value,
            style = NovaText.mono12.copy(color = palette.muted),
            maxLines = 1,
            modifier = Modifier.weight(1f),
        )
        if (chip != null) {
            Text(
                chip,
                style = NovaTypography.labelSmall,
                color = palette.accent,
                modifier = Modifier
                    .background(palette.accent11, RoundedCornerShape(99.dp))
                    .padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
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
