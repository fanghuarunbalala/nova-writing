package nova.agent.app.ui.approval

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import nova.agent.app.data.ApprovalUi
import nova.agent.app.ui.common.ScreenScaffold
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.vm.AppViewModel

/**
 * 审批中心（PRD FR7）：本地会话集 pending 聚合；跨端 resolve 直连（SSE 到达自动刷新）。
 * 行 UI 对齐 demo renderCenter（L2353-2372）：来源 chip + 工具 chip + 待批准 + 倒计时 + meta 行。
 */
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
                Text("此刻没有待审批的写入。\nAI 的每一次落笔，都会先到这里等你。", style = NovaText.kai.copy(color = palette.muted))
                Text(
                    "审批经 server 两段式持久化——任意端批准即生效（本地 resolve 与 SSE approval_resolved 先到者胜）；120s 无决策自动拒绝。",
                    style = NovaTypography.labelSmall.copy(color = palette.faint),
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
        } else {
            LazyColumn(
                contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(approvals, key = { "${it.requestId}#${it.cards.firstOrNull()?.id}" }) { approval ->
                    val card = approval.cards.first()
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .background(palette.surface, RoundedCornerShape(NovaDimens.radiusMd))
                            .clickable { openDetail = approval }
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                card.originChip ?: "本机",
                                style = NovaTypography.labelSmall,
                                color = palette.faint,
                                modifier = Modifier
                                    .background(palette.surface2, RoundedCornerShape(99.dp))
                                    .padding(horizontal = 7.dp, vertical = 2.dp),
                            )
                            Text(
                                card.toolName,
                                style = NovaText.mono11,
                                color = palette.muted,
                                modifier = Modifier
                                    .background(palette.surface2, RoundedCornerShape(99.dp))
                                    .padding(horizontal = 7.dp, vertical = 2.dp),
                            )
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                modifier = Modifier
                                    .background(palette.warnBg, RoundedCornerShape(99.dp))
                                    .padding(horizontal = 7.dp, vertical = 2.dp),
                            ) {
                                Box(Modifier.size(5.dp).background(palette.warn, CircleShape))
                                Text("待批准", style = NovaTypography.labelSmall, color = palette.warn)
                            }
                            Spacer(Modifier.weight(1f))
                            CountdownChip(askedAt = approval.askedAt, deadlineMs = approval.deadlineMs)
                        }
                        Text(
                            "${card.op.symbol} ${card.title}",
                            style = NovaTypography.titleSmall,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        Text(
                            "${approval.requestId} · ${maxOf(card.changeRows.size, 1)} 项变更",
                            style = NovaText.mono11.copy(color = palette.faint),
                            modifier = Modifier.padding(top = 3.dp),
                        )
                    }
                }
                item {
                    Text(
                        "来自任意端的征询都会汇到这里——手机可以批桌面挂起的审批。",
                        style = NovaTypography.labelSmall.copy(color = palette.faint),
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
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

/** 120s 倒计时 chip（≤15s 变 danger，demo cdChip） */
@Composable
private fun CountdownChip(askedAt: Long, deadlineMs: Long) {
    val palette = LocalNovaPalette.current
    var left by remember(askedAt, deadlineMs) {
        mutableLongStateOf(((askedAt + deadlineMs - System.currentTimeMillis()) / 1000).coerceAtLeast(0))
    }
    LaunchedEffect(askedAt, deadlineMs) {
        while (isActive && left > 0) {
            delay(1000)
            left = ((askedAt + deadlineMs - System.currentTimeMillis()) / 1000).coerceAtLeast(0)
        }
    }
    Text(
        "${left}s",
        style = NovaText.mono11,
        color = if (left <= 15) palette.danger else palette.warn,
    )
}
