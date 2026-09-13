package nova.agent.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import nova.agent.app.data.DeviceUi
import nova.agent.app.ui.common.ScreenScaffold
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography

/** 设备管理（PRD FR8）：已登录设备列表；踢出=吊销该端令牌，踢自己 → 登录门（对齐阶段1语义） */
@Composable
fun DevicesScreen(vm: nova.agent.app.ui.vm.AppViewModel, onBack: () -> Unit) {
    val palette = LocalNovaPalette.current
    val devices by vm.devices.collectAsStateWithLifecycle()
    var kickTarget by remember { mutableStateOf<DeviceUi?>(null) }
    val feedback = nova.agent.app.ui.common.rememberFeedback()

    ScreenScaffold(title = "设备管理", onBack = onBack) {
        LazyColumn(
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(devices, key = { it.id }) { device ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(Icons.Outlined.PhoneAndroid, contentDescription = null, tint = if (device.current) palette.accent else palette.faint, modifier = Modifier.size(20.dp))
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(device.name, style = NovaTypography.bodyLarge)
                            if (device.current) {
                                Text(
                                    "本机",
                                    style = NovaTypography.labelSmall,
                                    color = palette.accent,
                                    modifier = Modifier
                                        .background(palette.accent11, RoundedCornerShape(99.dp))
                                        .padding(horizontal = 8.dp, vertical = 2.dp),
                                )
                            }
                        }
                        Text(device.lastActiveLabel, style = NovaText.mono12.copy(color = palette.faint))
                    }
                    if (!device.current) {
                        Text(
                            "踢出",
                            style = NovaTypography.labelMedium,
                            color = palette.danger,
                            modifier = Modifier
                                .clickable { kickTarget = device }
                                .padding(8.dp),
                        )
                    }
                }
            }
        }
    }

    kickTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { kickTarget = null },
            containerColor = palette.surface,
            title = { Text("踢出「${target.name}」？", style = NovaTypography.titleSmall) },
            text = { Text("该设备令牌将被吊销，需重新登录。", style = NovaTypography.bodyMedium) },
            confirmButton = {
                TextButton(onClick = {
                    vm.kick(target.id)
                    feedback("已踢出 ${target.name}——该设备的 refresh token 已吊销")
                    kickTarget = null
                }) { Text("踢出", color = palette.danger) }
            },
            dismissButton = { TextButton(onClick = { kickTarget = null }) { Text("取消", color = palette.muted) } },
        )
    }
}
