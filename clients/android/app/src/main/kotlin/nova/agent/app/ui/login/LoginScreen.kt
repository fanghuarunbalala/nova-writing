package nova.agent.app.ui.login

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import nova.agent.app.data.AuthUiState
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.brandBrush
import nova.agent.app.ui.vm.AppViewModel

/**
 * 登录门（纯云端，无「先本地使用」逃生口）。
 * 阶段3：服务器地址栏（持久化 server_url）+ 服务端错误码文案（loginErrors）。
 */
@Composable
fun LoginScreen(vm: AppViewModel) {
    val palette = LocalNovaPalette.current
    val auth by vm.auth.collectAsStateWithLifecycle()
    val serverUrlHint by vm.serverUrlHint.collectAsStateWithLifecycle()

    var registerMode by rememberSaveable { mutableStateOf(false) }
    var serverUrl by rememberSaveable { mutableStateOf("") }
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var confirm by rememberSaveable { mutableStateOf("") }
    var deviceName by rememberSaveable { mutableStateOf(Build.MODEL) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val busy = auth is AuthUiState.LoggingIn

    // 已保存的服务器地址回填一次（不覆盖用户输入）
    LaunchedEffect(serverUrlHint) {
        if (serverUrl.isBlank() && serverUrlHint.isNotBlank()) serverUrl = serverUrlHint
    }
    // 服务端错误码 → 本地错误文案
    LaunchedEffect(Unit) {
        vm.loginErrors.collect { error = it }
    }

    fun submit() {
        val trimmedUrl = serverUrl.trim()
        error = when {
            !trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://") ->
                "服务器地址需以 http:// 或 https:// 开头"
            username.isBlank() -> "请输入用户名"
            registerMode && password.length < 8 -> "密码至少 8 位（weak_password）"
            registerMode && password != confirm -> "两次密码不一致"
            else -> null
        } ?: run {
            if (registerMode) vm.register(username, password, deviceName, trimmedUrl)
            else vm.login(username, password, deviceName, trimmedUrl)
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
        Spacer(Modifier.height(96.dp))
        // 品牌渐变字标（--grad-accent clip 到文字）
        Text(
            "nova",
            style = TextStyle(fontSize = 46.sp, fontWeight = FontWeight.Bold, brush = palette.brandBrush()),
        )
        Text(
            "云端书房 · 长夜与余烬",
            style = NovaText.kai.copy(color = palette.muted),
            modifier = Modifier.padding(top = 10.dp),
        )
        Spacer(Modifier.height(56.dp))

        OutlinedTextField(
            value = serverUrl,
            onValueChange = { serverUrl = it },
            label = { Text("服务器地址") },
            placeholder = { Text("https://your-nova-server") },
            singleLine = true,
            enabled = !busy,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("用户名") },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("密码") },
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
            label = { Text("设备名（踢出管理用）") },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )

        if (error != null) {
            Text(
                error!!,
                color = palette.danger,
                style = nova.agent.app.ui.theme.NovaTypography.bodySmall,
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

        TextButton(onClick = { registerMode = !registerMode; error = null }, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) {
            Text(if (registerMode) "已有账号？返回登录" else "没有账号？注册一个")
        }

        Spacer(Modifier.weight(1f))
        Text(
            "纯云端 · 无本地模式\n${serverUrl.ifBlank { "未配置服务器地址" }}",
            style = NovaText.mono11.copy(color = palette.faint, fontWeight = androidx.compose.ui.text.font.FontWeight.Normal),
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 24.dp),
        )
    }
}

private fun Modifier.clickableEnabled(enabled: Boolean, onClick: () -> Unit): Modifier =
    if (enabled) this.clickable(onClick = onClick) else this
