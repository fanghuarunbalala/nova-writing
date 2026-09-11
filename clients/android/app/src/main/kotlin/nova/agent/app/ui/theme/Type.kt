package nova.agent.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import nova.agent.app.R

// demo 用 550/650 两档"中间"字重（CSS --fw-medium/--fw-semibold），Compose 允许任意整数字重
val FwMedium = FontWeight(550)
val FwSemibold = FontWeight(650)

/**
 * M3 槽位映射 demo 字号阶（10.5–16.5sp）。
 * M3 组件（按钮/输入框/弹层）吃这些槽；聊天特有字形见 [NovaText]。
 */
val NovaTypography = Typography(
    labelSmall = TextStyle(fontSize = 10.5.sp, lineHeight = 14.sp, fontWeight = FwMedium),
    labelMedium = TextStyle(fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FwMedium),
    labelLarge = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FwSemibold),
    bodySmall = TextStyle(fontSize = 12.5.sp, lineHeight = 21.sp),   // 1.7
    bodyMedium = TextStyle(fontSize = 13.5.sp, lineHeight = 23.sp),
    bodyLarge = TextStyle(fontSize = 14.sp, lineHeight = 22.4.sp),   // 1.6
    titleSmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FwSemibold),
    titleMedium = TextStyle(fontSize = 15.5.sp, lineHeight = 22.sp, fontWeight = FwSemibold),
    titleLarge = TextStyle(fontSize = 16.5.sp, lineHeight = 24.sp, fontWeight = FwSemibold),
)

/** 聊天/阅读特有字形（demo --font-body 衬线、--font-mono、--font-kai） */
object NovaText {
    /** aiProse 15.5/1.85 */
    val prose = TextStyle(fontSize = 15.5.sp, lineHeight = 28.6.sp, fontFamily = FontFamily.Serif)

    /** draftText 15.5/1.95 */
    val draft = TextStyle(fontSize = 15.5.sp, lineHeight = 30.2.sp, fontFamily = FontFamily.Serif)

    /** 阅读视图 16.5/2.05 */
    val reading = TextStyle(fontSize = 16.5.sp, lineHeight = 33.8.sp, fontFamily = FontFamily.Serif)

    /** 审批卡正文 13/1.85 衬线 */
    val approvalBody = TextStyle(fontSize = 13.sp, lineHeight = 24.sp, fontFamily = FontFamily.Serif)

    /** 工具名/计秒（--font-mono） */
    val mono11 = TextStyle(fontSize = 11.sp, fontFamily = FontFamily.Monospace, fontWeight = FwSemibold)
    val mono12 = TextStyle(fontSize = 12.sp, fontFamily = FontFamily.Monospace)

    /** 点睛文案（--font-kai 楷体；子集字体未打包时回落 Serif） */
    val kai = TextStyle(fontSize = 13.sp, lineHeight = 22.sp, fontFamily = NovaKai)
}

/**
 * 楷体字族：res/font/nova_kai.ttf = 霞鹜文楷子集（GB2312 一级 3755 字 + 标点，~1.7MB，
 * 由 scripts/subset-font.py 生成，SIL OFL 1.1 见 app/LICENSES/）。
 * 子集外字形渲染时系统按字形自动回落 Serif。
 */
val NovaKai: FontFamily = FontFamily(Font(R.font.nova_kai))
