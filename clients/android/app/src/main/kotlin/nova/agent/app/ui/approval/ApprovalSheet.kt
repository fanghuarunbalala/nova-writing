package nova.agent.app.ui.approval

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import nova.agent.app.data.ApprovalCardUi
import nova.agent.app.data.ApprovalDecision
import nova.agent.app.data.ApprovalOp
import nova.agent.app.data.ApprovalUi
import nova.agent.app.ui.common.rememberFeedback
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.theme.brandBrush

/**
 * 审批 BottomSheet（demo apSheet L1648-1669 逐字对齐）：
 * 头部「审批 N」+ 倒计时（≤15s 变 danger）+ meta 子标题；
 * 整批行「本批 N 项 / 全部批准 / 全部驳回」；三型卡（edit~ / add+ / delete−）
 * 含 curBox（键值行）、变更带（键值行）、verBanner 版本过期黄条；
 * 驳回**必须附意见**（空意见拦截）；裁决留痕走 reducer（SysLine）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalSheet(
    approval: ApprovalUi,
    onCardDecided: (requestId: String, cardId: String, approved: Boolean, comment: String?) -> Unit,
    onBatchDecided: (requestId: String, approved: Boolean) -> Unit,
    onTimeout: (requestId: String) -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = LocalNovaPalette.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // 倒计时（≤15s 变 danger，demo cdChip；deadlineMs 变化时重算——速演触发器用）
    val deadline = approval.askedAt + approval.deadlineMs
    var left by remember(approval.requestId, approval.deadlineMs) {
        mutableLongStateOf((deadline - System.currentTimeMillis()) / 1000)
    }
    LaunchedEffect(approval.requestId, approval.deadlineMs) {
        var last = (deadline - System.currentTimeMillis()) / 1000
        while (isActive && last > 0) {
            left = last
            delay(1000)
            last = (deadline - System.currentTimeMillis()) / 1000
        }
        if (last <= 0) {
            left = 0
            onTimeout(approval.requestId)
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = palette.surface,
        shape = RoundedCornerShape(topStart = NovaDimens.radiusSheet, topEnd = NovaDimens.radiusSheet),
        dragHandle = {
            Box(
                Modifier
                    .padding(top = 10.dp, bottom = 4.dp)
                    .size(width = 36.dp, height = 4.dp)
                    .background(palette.borderStrong, RoundedCornerShape(2.dp)),
            )
        },
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
        ) {
            // 头部：审批 + 待批数徽标 + 倒计时 chip（demo L1651-1661）
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("审批", style = NovaTypography.titleSmall)
                Text(
                    approval.cards.size.toString(),
                    style = NovaTypography.labelSmall,
                    color = palette.warn,
                    modifier = Modifier
                        .background(palette.warnBg, RoundedCornerShape(99.dp))
                        .padding(horizontal = 7.dp, vertical = 1.dp),
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "${left}s",
                    style = NovaText.mono11,
                    color = if (left <= 15) palette.danger else palette.warn,
                )
            }
            Text(
                "${approval.requestId} · 一次工具调用一批 · 批量决策作用于整批",
                style = NovaText.mono11.copy(color = palette.faint),
                modifier = Modifier.padding(top = 2.dp, bottom = 10.dp),
            )

            // 整批裁决行（demo batchRow L1663-1667）
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "本批 ${approval.cards.size} 项",
                    style = NovaTypography.labelMedium.copy(color = palette.muted),
                    modifier = Modifier.weight(1f),
                )
                GradientPillButton("全部批准") { onBatchDecided(approval.requestId, true) }
                OutlinedDangerButton("全部驳回") { onBatchDecided(approval.requestId, false) }
            }

            approval.cards.forEach { card ->
                Spacer(Modifier.height(10.dp))
                ApprovalCard(
                    card = card,
                    onDecide = { approved, comment ->
                        onCardDecided(approval.requestId, card.id, approved, comment)
                    },
                )
            }
            Spacer(Modifier.height(6.dp))
        }
    }
}

/** 三型审批卡（demo apCard；verBanner 版本过期 + 键值行 + 驳回必附意见） */
@Composable
fun ApprovalCard(card: ApprovalCardUi, onDecide: (approved: Boolean, comment: String?) -> Unit) {
    val palette = LocalNovaPalette.current
    val feedback = rememberFeedback()
    var opinionOpen by remember(card.id) { mutableStateOf(false) }
    var opinion by remember(card.id) { mutableStateOf("") }
    val decided = card.decision != ApprovalDecision.PENDING

    Column(
        Modifier
            .fillMaxWidth()
            .background(palette.bg, RoundedCornerShape(NovaDimens.radiusMd))
            .border(1.dp, palette.border, RoundedCornerShape(NovaDimens.radiusMd))
            .padding(horizontal = 13.dp, vertical = 12.dp),
    ) {
        // 工具名 + 来源 chip + 状态 chip
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(card.toolName, style = NovaText.mono11, color = palette.muted, modifier = Modifier.weight(1f))
            card.originChip?.let {
                Text(
                    it,
                    style = NovaTypography.labelSmall,
                    color = palette.faint,
                    modifier = Modifier
                        .background(palette.surface2, RoundedCornerShape(99.dp))
                        .padding(horizontal = 7.dp, vertical = 2.dp),
                )
            }
            DecisionChip(card.decision)
        }

        // 标题行：op 符号（+ 成功色 / ~ accent-ink / − danger）
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            Text(
                card.op.symbol,
                style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Bold),
                color = when (card.op) {
                    ApprovalOp.ADD -> palette.success
                    ApprovalOp.EDIT -> palette.accentInk
                    ApprovalOp.DELETE -> palette.danger
                },
            )
            Text(card.title, style = NovaTypography.titleSmall)
        }
        Text(
            card.op.label,
            style = NovaTypography.labelSmall.copy(color = palette.faint),
            modifier = Modifier.padding(start = 23.dp),
        )

        // 版本过期黄条（demo verBanner L2229：edit 卡 stale v2→v3）
        if (card.baseVersion != null && card.staleVersion != null) {
            Text(
                "版本已过期：正式稿已被其他修改更新（基线 ${card.baseVersion} → 当前 ${card.staleVersion}），批准后此操作可能执行失败。",
                style = NovaTypography.labelSmall.copy(color = palette.warn),
                modifier = Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .background(palette.warnBg, RoundedCornerShape(NovaDimens.radiusSm))
                    .padding(horizontal = 9.dp, vertical = 6.dp),
            )
        }

        // 当前内容框（curBox：edit/delete 实色警示边；add 虚线；小节标题按 op 语义）
        val currentText = card.current
        if (currentText != null || card.currentRows.isNotEmpty()) {
            Column(
                Modifier
                    .padding(top = 10.dp)
                    .fillMaxWidth()
                    .background(
                        when (card.op) {
                            ApprovalOp.DELETE -> palette.danger.copy(alpha = 0.05f)
                            else -> palette.warn6
                        },
                    )
                    .curBoxBorder(card.op, palette.borderStrong, palette.danger, palette.warn)
                    .padding(10.dp),
            ) {
                Text(
                    when (card.op) {
                        ApprovalOp.EDIT -> "当前内容 · 将被覆盖"
                        ApprovalOp.ADD -> "当前内容 · 无既有数据 · 此操作为新建"
                        ApprovalOp.DELETE -> "当前内容 · 将被删除"
                    },
                    style = NovaTypography.labelSmall.copy(color = palette.faint),
                )
                if (card.currentRows.isNotEmpty()) {
                    card.currentRows.forEach { (k, v) ->
                        Row(Modifier.padding(top = 3.dp)) {
                            Text(k, style = NovaText.mono11.copy(color = palette.muted), modifier = Modifier.width(44.dp))
                            Text(v, style = NovaText.approvalBody.copy(color = palette.fg))
                        }
                    }
                } else {
                    Text(
                        currentText.orEmpty(),
                        style = NovaText.approvalBody.copy(color = palette.fg),
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }
        }

        // 变更带（chgBand 色语义 + 键值行）
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(top = 10.dp),
        ) {
            Box(
                Modifier
                    .background(
                        when (card.op) {
                            ApprovalOp.ADD -> palette.successBg
                            ApprovalOp.DELETE -> palette.dangerBg
                            ApprovalOp.EDIT -> palette.accent11
                        },
                        RoundedCornerShape(5.dp),
                    )
                    .padding(horizontal = 9.dp, vertical = 4.dp),
            ) {
                Text(
                    when (card.op) {
                        ApprovalOp.ADD -> "写入内容"
                        ApprovalOp.DELETE -> "删除参数"
                        ApprovalOp.EDIT -> "变更后"
                    },
                    style = TextStyle(
                        fontSize = 10.5.sp, fontWeight = FontWeight.Bold,
                        color = when (card.op) {
                            ApprovalOp.ADD -> palette.success
                            ApprovalOp.DELETE -> palette.danger
                            ApprovalOp.EDIT -> palette.accentInk
                        },
                    ),
                )
            }
            Text("变更说明", style = NovaTypography.labelSmall.copy(color = palette.muted))
        }
        if (card.changeRows.isNotEmpty()) {
            card.changeRows.forEach { (k, v) ->
                Row(Modifier.padding(top = 4.dp)) {
                    Text(k, style = NovaText.mono11.copy(color = palette.muted), modifier = Modifier.width(44.dp))
                    Text(v, style = NovaText.approvalBody.copy(color = palette.fg))
                }
            }
        } else {
            Text(
                card.change,
                style = NovaText.approvalBody.copy(color = palette.fg),
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        // 裁决区：意见必填（demo L2234-2238）；裁决后落结果行（apDone 三态）
        if (!decided) {
            if (opinionOpen) {
                OutlinedTextField(
                    value = opinion,
                    onValueChange = { opinion = it },
                    placeholder = { Text("驳回意见会作为 tool 消息回填给运行中的会话…", style = NovaTypography.bodySmall) },
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                    minLines = 2,
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.padding(top = 8.dp),
                ) {
                    OutlinedDangerButton("取消", Modifier.weight(1f)) { opinionOpen = false }
                    GradientPillButton("提交驳回意见", Modifier.weight(1f)) {
                        if (opinion.isBlank()) {
                            feedback("驳回请附意见——它会回填给运行中的会话")
                        } else {
                            onDecide(false, opinion.trim())
                        }
                    }
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 10.dp)) {
                    GradientPillButton("批准", Modifier.weight(1f)) { onDecide(true, null) }
                    OutlinedDangerButton("驳回并附意见", Modifier.weight(1f)) { opinionOpen = true }
                }
            }
        } else {
            Text(
                when (card.decision) {
                    ApprovalDecision.APPROVED -> "已处理 · 已批准——放行并通知会话继续"
                    ApprovalDecision.REJECTED -> "已处理 · 已拒绝"
                    ApprovalDecision.EXPIRED -> "已过期 · 120s 无决策自动拒绝（server 懒过期）"
                    ApprovalDecision.PENDING -> ""
                },
                style = NovaTypography.labelSmall.copy(
                    color = when (card.decision) {
                        ApprovalDecision.APPROVED -> palette.success
                        ApprovalDecision.REJECTED -> palette.danger
                        ApprovalDecision.EXPIRED -> palette.warn
                        ApprovalDecision.PENDING -> palette.faint
                    },
                ),
                modifier = Modifier.padding(top = 10.dp),
            )
        }
    }
}

@Composable
private fun DecisionChip(decision: ApprovalDecision) {
    val palette = LocalNovaPalette.current
    val (bg, fg, label) = when (decision) {
        ApprovalDecision.PENDING -> Triple(palette.warnBg, palette.warn, "待批准")
        ApprovalDecision.APPROVED -> Triple(palette.successBg, palette.success, "已批准")
        ApprovalDecision.REJECTED -> Triple(palette.dangerBg, palette.danger, "已拒绝")
        ApprovalDecision.EXPIRED -> Triple(palette.warnBg, palette.warn, "已过期")
    }
    Text(
        label,
        style = NovaTypography.labelSmall,
        color = fg,
        modifier = Modifier
            .background(bg, RoundedCornerShape(99.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** curBox 左侧 3dp 竖条（delete=danger 实线；add=dashed；edit=warn）；颜色在组合期捕获 */
private fun Modifier.curBoxBorder(
    op: ApprovalOp,
    borderStrong: Color,
    danger: Color,
    warn: Color,
): Modifier = drawBehind {
    val width = 3.dp.toPx()
    val top = androidx.compose.ui.geometry.Offset(0f, 0f)
    val bottom = androidx.compose.ui.geometry.Offset(0f, size.height)
    when (op) {
        ApprovalOp.ADD -> drawLine(
            borderStrong, top, bottom, width,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())),
        )
        ApprovalOp.DELETE -> drawLine(danger, top, bottom, width)
        ApprovalOp.EDIT -> drawLine(warn, top, bottom, width)
    }
}

/** 品牌渐变实心钮（demo 批准） */
@Composable
fun GradientPillButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val palette = LocalNovaPalette.current
    Box(
        modifier
            .height(44.dp)
            .background(palette.brandBrush(), RoundedCornerShape(99.dp))
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = palette.onAccent, style = NovaTypography.labelLarge)
    }
}

/** danger 描边钮（demo 驳回） */
@Composable
fun OutlinedDangerButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val palette = LocalNovaPalette.current
    Box(
        modifier
            .height(44.dp)
            .border(1.dp, palette.danger32, RoundedCornerShape(99.dp))
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = palette.danger, style = NovaTypography.labelLarge)
    }
}
