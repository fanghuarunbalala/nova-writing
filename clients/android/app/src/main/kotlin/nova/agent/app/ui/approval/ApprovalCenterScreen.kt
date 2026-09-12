package nova.agent.app.ui.approval

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FactCheck
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import nova.agent.app.data.ApprovalUi
import nova.agent.app.ui.common.ScreenScaffold
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.vm.AppViewModel

/** 审批中心（PRD FR7）：本地会话集 pending 聚合；跨端 resolve 直连（SSE 到达自动刷新） */
@Composable
fun ApprovalCenterScreen(vm: AppViewModel, onBack: () -> Unit) {
    val palette = LocalNovaPalette.current
    val approvals by vm.approvals.collectAsStateWithLifecycle()
    var openDetail by remember { mutableStateOf<ApprovalUi?>(null) }

    // ON_START 聚合刷新（§1.2-⑨③）
    androidx.compose.runtime.LaunchedEffect(Unit) { vm.refreshApprovals() }

    ScreenScaffold(title = "审批中心", onBack = onBack) {
        if (approvals.isEmpty()) {
            Column(
                Modifier.fillMaxSize().padding(48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("暂无待审批变更", style = NovaText.kai.copy(color = palette.muted))
                Text("工具的写操作会先落到这里等你裁决", style = NovaTypography.labelSmall.copy(color = palette.faint))
            }
        } else {
            LazyColumn(
                contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(approvals, key = { it.requestId }) { approval ->
                    val card = approval.cards.first()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                            .clickable { openDetail = approval }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(
                            Icons.Outlined.FactCheck,
                            contentDescription = null,
                            tint = palette.warn,
                            modifier = Modifier.size(18.dp),
                        )
                        Column(Modifier.weight(1f)) {
                            Text(card.title, style = NovaTypography.titleSmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                card.originChip?.let { Text(it, style = NovaTypography.labelSmall.copy(color = palette.faint)) }
                                Text(card.toolName, style = NovaText.mono11, color = palette.muted)
                            }
                        }
                        Text(
                            "${approval.cards.size} 项",
                            style = NovaTypography.labelSmall.copy(color = palette.warn),
                        )
                    }
                }
            }
        }
    }

    openDetail?.let { detail ->
        ApprovalSheet(
            approval = detail,
            onCardDecided = { _, cardId, approved, _ ->
                // demo：中心条目本地裁决（不回写服务器）；视觉上直接移除该卡
                vm.resolveCenterApprovalCard(detail.requestId, cardId, approved)
            },
            onBatchDecided = { requestId, _ -> vm.resolveCenterApproval(requestId) },
            onTimeout = { requestId -> vm.resolveCenterApproval(requestId) },
            onDismiss = { openDetail = null },
        )
    }
}
