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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import nova.agent.app.data.ApprovalCardUi
import nova.agent.app.data.ApprovalDecision
import nova.agent.app.data.ApprovalOp
import nova.agent.app.data.ApprovalUi
import nova.agent.app.ui.theme.FwMedium
import nova.agent.app.ui.theme.FwSemibold
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaDimens
import nova.agent.app.ui.theme.NovaText
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.theme.brandBrush

/**
 * 审批 BottomSheet（demo .apSheet）：120s 倒计时 + 三型卡（编辑~/新建+/删除−）
 * + 逐卡批准/驳回（驳回可附意见）+ 整批裁决行。裁决回填走 reducer（SysPill）。
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

    val deadline = approval.askedAt + approval.deadlineMs
    var left by remember(approval.requestId) { mutableLongStateOf((deadline - System.currentTimeMillis()) / 1000) }
    LaunchedEffect(approval.requestId) {
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
            // 标题 + 倒计时 chip（<10s 变 danger）
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("审批请求", style = NovaTypography.titleSmall, modifier = Modifier.weight(1f))
                Text(
                    "${left}s",
                    style = NovaText.mono11,
                    color = if (left < 10) palette.danger else palette.warn,
                )
            }
            Text(
                "以下工具变更将写入项目数据；驳回可附意见供模型修正。",
                style = NovaTypography.bodySmall.copy(color = palette.muted),
                modifier = Modifier.padding(top = 2.dp, bottom = 10.dp),
            )

            approval.cards.forEach { card ->
                ApprovalCard(
                    card = card,
                    onDecide = { approved, comment ->
                        onCardDecided(approval.requestId, card.id, approved, comment)
                    },
                )
                Spacer(Modifier.height(10.dp))
            }

            // 整批裁决
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 4.dp)) {
                GradientPillButton("全部批准", Modifier.weight(1f)) { onBatchDecided(approval.requestId, true) }
                OutlinedDangerButton("全部驳回", Modifier.weight(1f)) { onBatchDecided(approval.requestId, false) }
            }
        }
    }
}

/** 三型审批卡（demo .apCard） */
@Composable
fun ApprovalCard(card: ApprovalCardUi, onDecide: (approved: Boolean, comment: String?) -> Unit) {
    val palette = LocalNovaPalette.current
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
        // 工具名 + 状态 chip + 来源
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(card.toolName, style = NovaText.mono11, color = palette.muted, modifier = Modifier.weight(1f))
            card.originChip?.let {
                Text(it, style = NovaTypography.labelSmall.copy(color = palette.faint))
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

        // 当前内容框（curBox：edit/delete 实色警示边；add 虚线）
        card.current?.let { current ->
            Box(
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
                Column {
                    Text("当前内容", style = NovaTypography.labelSmall.copy(color = palette.faint))
                    Text(current, style = NovaText.approvalBody.copy(color = palette.fg), modifier = Modifier.padding(top = 2.dp))
                }
            }
        }

        // 变更带（chgBand 色语义）
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
                        ApprovalOp.ADD -> "新增"
                        ApprovalOp.DELETE -> "删除"
                        ApprovalOp.EDIT -> "修改"
                    },
                    style = TextStyle(fontSize = 10.5.sp, fontWeight = FontWeight.Bold, color = when (card.op) {
                        ApprovalOp.ADD -> palette.success
                        ApprovalOp.DELETE -> palette.danger
                        ApprovalOp.EDIT -> palette.accentInk
                    }),
                )
            }
            Text("变更说明", style = NovaTypography.labelSmall.copy(color = palette.muted))
        }
        Text(
            card.change,
            style = NovaText.approvalBody.copy(color = palette.fg),
            modifier = Modifier.padding(top = 4.dp),
        )

        // 裁决按钮 / 结果盖章
        if (!decided) {
            if (opinionOpen) {
                OutlinedTextField(
                    value = opinion,
                    onValueChange = { opinion = it },
                    placeholder = { Text("驳回意见（可选）", style = NovaTypography.bodySmall) },
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                    minLines = 2,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 10.dp)) {
                GradientPillButton("批准", Modifier.weight(1f)) { onDecide(true, null) }
                OutlinedDangerButton(
                    if (opinionOpen) "驳回并附意见" else "驳回",
                    Modifier.weight(1f),
                ) {
                    if (opinionOpen) onDecide(false, opinion.ifBlank { null }) else opinionOpen = true
                }
            }
        }
    }
}

@Composable
private fun DecisionChip(decision: ApprovalDecision) {
    val palette = LocalNovaPalette.current
    val (bg, fg, label) = when (decision) {
        ApprovalDecision.PENDING -> Triple(palette.warnBg, palette.warn, "待裁决")
        ApprovalDecision.APPROVED -> Triple(palette.successBg, palette.success, "已批准")
        ApprovalDecision.REJECTED -> Triple(palette.dangerBg, palette.danger, "已驳回")
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
