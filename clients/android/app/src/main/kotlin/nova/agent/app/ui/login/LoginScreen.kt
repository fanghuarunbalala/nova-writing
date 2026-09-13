package nova.agent.app.ui.login

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import nova.agent.app.data.AppRepository
import nova.agent.app.data.AuthUiState
import nova.agent.app.ui.common.rememberFeedback
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.theme.brandBrush
import nova.agent.app.ui.vm.AppViewModel

/**
 * 登录门（demo L1571-1602 逐字对齐；纯云端，无「先本地使用」逃生口）：
 * 服务器/用户名/密码/设备名 → 成功态页（okBadge + 双令牌说明 + 开始使用）；
 * NeedRelogin 进入时顶部 reloginBanner；排障提示可展开。
 * demo：任意用户名 + 合法密码直接 Online（阶段3 接真实 auth）。
 */
@Composable
fun LoginScreen(vm: AppViewModel, onFinished: () -> Unit = {}) {
    val palette = LocalNovaPalette.current
    val feedback = rememberFeedback()
    val auth by vm.auth.collectAsStateWithLifecycle()

    var registerMode by rememberSaveable { mutableStateOf(false) }
    var server by rememberSaveable { mutableStateOf(AppRepository.DEMO_SERVER) }
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var confirm by rememberSaveable { mutableStateOf("") }
    var deviceName by rememberSaveable { mutableStateOf("Android · ${Build.MODEL}") }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var troubleshootOpen by rememberSaveable { mutableStateOf(false) }
    val busy = auth is AuthUiState.LoggingIn

    // ---- 成功态页（demo L1595-1600）：okBadge + 用户名@server + 双令牌 + 开始使用 ----
    val online = auth as? AuthUiState.Online
    if (online != null) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(palette.bg)
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(120.dp))
            Box(
                Modifier
                    .size(64.dp)
                    .background(palette.successBg, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Rounded.Check, contentDescription = null, tint = palette.success, modifier = Modifier.size(34.dp))
            }
            Text(
                "${online.username}@${online.serverUrl.removePrefix("https://")}",
                style = NovaTypography.titleMedium,
                modifier = Modifier.padding(top = 18.dp),
            )
            Text(
                "设备 $deviceName 已注册 · 双令牌已安全存储",
                style = NovaTypography.bodySmall.copy(color = palette.muted),
                modifier = Modifier.padding(top = 6.dp),
            )
            Text(
                "JWT 15min · refresh 60 天 · 过期前 1 分钟自动轮换",
                style = NovaText.mono11.copy(color = palette.faint),
                modifier = Modifier.padding(top = 4.dp),
            )
            Spacer(Modifier.height(40.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .background(palette.brandBrush(), RoundedCornerShape(NovaDimens.radiusPill))
                    .clickable {
                        feedback("双令牌已存入安全存储——过期前 1 分钟自动轮换")
                        onFinished()
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text("开始使用", color = palette.onAccent, style = TextStyle(fontSize = 15.sp, fontWeight = FwMedium))
            }
        }
        return
    }

    fun submit() {
        error = when {
            username.isBlank() -> "请输入用户名"
            password.length < 6 -> "密码至少 6 位（401 invalid_credentials 演示）"
            registerMode && password != confirm -> "两次密码不一致"
            else -> null
        } ?: run {
            if (registerMode) vm.register(username, password, deviceName, server)
            else vm.login(username, password, deviceName, server)
            null
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // reloginBanner（demo L1580）：refresh token 复用 → 会话族吊销
        if (auth is AuthUiState.NeedRelogin) {
            Text(
                "登录已过期——检测到 refresh token 复用，整个会话族已吊销，请重新登录。",
                style = NovaTypography.bodySmall.copy(color = palette.warn),
                modifier = Modifier
                    .padding(top = 12.dp)
                    .fillMaxWidth()
                    .background(palette.warnBg, RoundedCornerShape(NovaDimens.radiusMd))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            )
        }
        Spacer(Modifier.height(72.dp))
        // 品牌行（demo L1576-1578）
        Text(
            "Nova Writing",
            style = TextStyle(fontSize = 40.sp, fontWeight = FontWeight.Bold, brush = palette.brandBrush()),
        )
        Text(
            "桌面在写，手机在批。",
            style = NovaText.kai.copy(color = palette.muted),
            modifier = Modifier.padding(top = 10.dp),
        )
        Text(
            "登录后，任意一端的审批都汇到这里。",
            style = NovaTypography.labelSmall.copy(color = palette.faint),
            modifier = Modifier.padding(top = 4.dp),
        )
        Spacer(Modifier.height(40.dp))

        OutlinedTextField(
            value = server,
            onValueChange = { server = it },
            label = { Text("服务器") },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("用户名") },
            placeholder = { Text("3-32 个字符") },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("密码") },
            placeholder = { Text("至少 8 位") },
            singleLine = true,
            enabled = !busy,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        if (registerMode) {
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = confirm,
                onValueChange = { confirm = it },
                label = { Text("确认密码") },
                singleLine = true,
                enabled = !busy,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = deviceName,
            onValueChange = { deviceName = it },
            label = { Text("设备名（多端会话中如何称呼这台设备）") },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )

        if (error != null) {
            Text(
                error!!,
                color = palette.danger,
                style = NovaTypography.bodySmall,
                modifier = Modifier.padding(top = 12.dp).fillMaxWidth(),
            )
        }

        Spacer(Modifier.height(24.dp))

        // 品牌渐变实心按钮（demo mBtn：48dp 高、pill、渐变底）
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .background(palette.brandBrush(), RoundedCornerShape(NovaDimens.radiusPill))
                .clickableEnabled(!busy) { submit() },
            contentAlignment = Alignment.Center,
        ) {
            if (busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = palette.onAccent,
                )
            } else {
                Text(
                    if (registerMode) "注册并登录" else "登录",
                    color = palette.onAccent,
                    style = TextStyle(fontSize = 15.sp, fontWeight = FwMedium),
                )
            }
        }

        Text(
            if (registerMode) "注册即颁发双令牌（201）；用户名重复将提示 409。" else "错误统一提示「用户名或密码错误」（防枚举）。",
            style = NovaTypography.labelSmall.copy(color = palette.faint),
            modifier = Modifier.padding(top = 10.dp),
        )

        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { registerMode = !registerMode; error = null }, enabled = !busy) {
                Text(if (registerMode) "已有账号？登录" else "没有账号？注册")
            }
            Text(
                "·",
                color = palette.faint,
            )
            TextButton(onClick = { troubleshootOpen = !troubleshootOpen }, enabled = !busy) {
                Text("连不上？查看排障提示")
            }
        }
        if (troubleshootOpen) {
            Text(
                "纯云端架构：登录为唯一入口（强制登录门）。排障——检查服务器地址 / 自签证书 / 局域网可达性。",
                style = NovaTypography.bodySmall.copy(color = palette.muted),
                modifier = Modifier
                    .fillMaxWidth()
                    .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                    .padding(12.dp),
            )
        }

        Spacer(Modifier.weight(1f))
        Text(
            "纯云端 · 无本地模式\n${AppRepository.DEMO_SERVER}",
            style = NovaText.mono11.copy(color = palette.faint, fontWeight = FontWeight.Normal),
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 24.dp),
        )
    }
}

private fun Modifier.clickableEnabled(enabled: Boolean, onClick: () -> Unit): Modifier =
    if (enabled) this.clickable(onClick = onClick) else this
