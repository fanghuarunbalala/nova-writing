package nova.agent.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * ★ 本文件由 scripts/gen-theme.mjs 从 docs/design/android-app-demo.html 自动生成，勿手改。
 * 源 token：oklch CSS 变量 → sRGB；color-mix(in oklab) 派生色按同一语义在脚本内计算。
 * 重跑（幂等，应零 diff）：clients/android 下 `node scripts/gen-theme.mjs`
 */

data class NovaPalette(
    val bg: Color, // bg
    val surface: Color, // surface
    val surface2: Color, // surface-2
    val fg: Color, // fg
    val muted: Color, // muted
    val faint: Color, // faint
    val border: Color, // border
    val borderStrong: Color, // border-strong
    val orange: Color, // orange
    val accent: Color, // accent
    val red: Color, // red
    val accentInk: Color, // accent-ink
    val success: Color, // success
    val successBg: Color, // success-bg
    val warn: Color, // warn
    val warnBg: Color, // warn-bg
    val danger: Color, // danger
    val dangerBg: Color, // danger-bg
    val info: Color, // info
    val infoBg: Color, // info-bg
    val onAccent: Color, // on-accent
    val accent9: Color, // color-mix: accent 9% + surface
    val accent8t: Color, // color-mix: accent 8% + transparent
    val accent11: Color, // color-mix: accent 11% + surface
    val accent45: Color, // color-mix: accent 45% + transparent
    val warn6: Color, // color-mix: warn 6% + transparent
    val warn40: Color, // color-mix: warn 40% + transparent
    val danger12: Color, // color-mix: danger 12% + surface
    val danger32: Color, // color-mix: danger 32% + transparent
    val chromeBg: Color, // color-mix: surface 82% + transparent
    val focusRing: Color, // color-mix: accent 42% + transparent
)

/** 宣纸白（默认浅色） */
val PaperPalette = NovaPalette(
    bg = Color(0xFFF9F8F6), // oklch(97.9% 0.003 85)
    surface = Color(0xFFFFFEFD), // oklch(99.8% 0.0015 85)
    surface2 = Color(0xFFF4F2EF), // oklch(96.2% 0.004 82)
    fg = Color(0xFF322C2A), // oklch(30% 0.009 46)
    muted = Color(0xFF6D6864), // oklch(52% 0.009 54)
    faint = Color(0xFF857F7B), // oklch(60% 0.009 58)
    border = Color(0xFFE7E6E4), // oklch(92.4% 0.003 82)
    borderStrong = Color(0xFFD5D2CE), // oklch(86.4% 0.006 72)
    orange = Color(0xFFC89E7D), // oklch(73% 0.068 60)
    accent = Color(0xFF966350), // oklch(55% 0.072 42)
    red = Color(0xFFA26A5E), // oklch(58% 0.075 32)
    accentInk = Color(0xFF794F3F), // oklch(47% 0.062 41)
    success = Color(0xFF467558), // oklch(52% 0.07 156)
    successBg = Color(0xFFF0F8F3), // oklch(97.2% 0.011 156)
    warn = Color(0xFF93794C), // oklch(59% 0.07 80)
    warnBg = Color(0xFFF9F5ED), // oklch(97.1% 0.011 86)
    danger = Color(0xFF926056), // oklch(54% 0.068 32)
    dangerBg = Color(0xFFFBF3F2), // oklch(97.1% 0.009 33)
    info = Color(0xFF527488), // oklch(54% 0.05 235)
    infoBg = Color(0xFFF2F7FA), // oklch(97.2% 0.007 236)
    onAccent = Color(0xFFFFFFFF), // #fff
    accent9 = Color(0xFF9F715E), // mix accent 9% + surface
    accent8t = Color(0x14966350), // accent @ 8% alpha
    accent11 = Color(0xFFA17462), // mix accent 11% + surface
    accent45 = Color(0x73966350), // accent @ 45% alpha
    warn6 = Color(0x0F93794C), // warn @ 6% alpha
    warn40 = Color(0x6693794C), // warn @ 40% alpha
    danger12 = Color(0xFF9F7268), // mix danger 12% + surface
    danger32 = Color(0x52926056), // danger @ 32% alpha
    chromeBg = Color(0xD1FFFEFD), // surface @ 82% alpha
    focusRing = Color(0x6B966350), // accent @ 42% alpha
)

/** 墨夜（暖深色） */
val InkPalette = NovaPalette(
    bg = Color(0xFF191816), // oklch(21% 0.005 80)
    surface = Color(0xFF242320), // oklch(25.5% 0.006 80)
    surface2 = Color(0xFF2C2A26), // oklch(28.5% 0.007 78)
    fg = Color(0xFFDCDAD6), // oklch(89% 0.006 85)
    muted = Color(0xFFA19E99), // oklch(70% 0.008 80)
    faint = Color(0xFF7F7D79), // oklch(59% 0.007 80)
    border = Color(0xFF32302C), // oklch(31% 0.007 80)
    borderStrong = Color(0xFF4B4742), // oklch(40% 0.01 78)
    orange = Color(0xFFE0A774), // oklch(77% 0.095 62)
    accent = Color(0xFFD47F5E), // oklch(68% 0.115 42)
    red = Color(0xFFCF7667), // oklch(66% 0.115 30)
    accentInk = Color(0xFFE8A587), // oklch(78% 0.09 45)
    success = Color(0xFF71B78C), // oklch(72% 0.095 156)
    successBg = Color(0xFF1E3025), // oklch(29% 0.032 156)
    warn = Color(0xFFCFA761), // oklch(75% 0.1 80)
    warnBg = Color(0xFF332A17), // oklch(29% 0.034 85)
    danger = Color(0xFFCB7E6E), // oklch(67% 0.1 32)
    dangerBg = Color(0xFF36231F), // oklch(28% 0.03 33)
    info = Color(0xFF6FA6C7), // oklch(70% 0.075 235)
    infoBg = Color(0xFF1D2B33), // oklch(28% 0.024 236)
    onAccent = Color(0xFF2C1A14), // oklch(24% 0.03 42)
    accent9 = Color(0xFFC27658), // mix accent 9% + surface
    accent8t = Color(0x14D47F5E), // accent @ 8% alpha
    accent11 = Color(0xFFBE7457), // mix accent 11% + surface
    accent45 = Color(0x73D47F5E), // accent @ 45% alpha
    warn6 = Color(0x0FCFA761), // warn @ 6% alpha
    warn40 = Color(0x66CFA761), // warn @ 40% alpha
    danger12 = Color(0xFFB57264), // mix danger 12% + surface
    danger32 = Color(0x52CB7E6E), // danger @ 32% alpha
    chromeBg = Color(0xD1242320), // surface @ 82% alpha
    focusRing = Color(0x6BD47F5E), // accent @ 42% alpha
)

/** 黛青（冷深色） */
val CeladonPalette = NovaPalette(
    bg = Color(0xFF10171B), // oklch(20% 0.013 235)
    surface = Color(0xFF182125), // oklch(24% 0.015 235)
    surface2 = Color(0xFF1E282D), // oklch(27% 0.017 232)
    fg = Color(0xFFD5DCDF), // oklch(89% 0.009 225)
    muted = Color(0xFF949DA2), // oklch(69% 0.013 230)
    faint = Color(0xFF737C80), // oklch(58% 0.012 230)
    border = Color(0xFF272F34), // oklch(30% 0.015 235)
    borderStrong = Color(0xFF39444B), // oklch(38% 0.019 232)
    orange = Color(0xFF81C6C1), // oklch(78% 0.07 190)
    accent = Color(0xFF53C2C1), // oklch(75% 0.1 195)
    red = Color(0xFF7797DD), // oklch(68% 0.11 265)
    accentInk = Color(0xFF8ED9E2), // oklch(84% 0.075 205)
    success = Color(0xFF6FB78E), // oklch(72% 0.095 158)
    successBg = Color(0xFF1B2E23), // oklch(28% 0.032 158)
    warn = Color(0xFFCAAE63), // oklch(76% 0.1 90)
    warnBg = Color(0xFF2F2816), // oklch(28% 0.032 88)
    danger = Color(0xFFD47C76), // oklch(68% 0.11 25)
    dangerBg = Color(0xFF362321), // oklch(28% 0.03 25)
    info = Color(0xFF75ACD2), // oklch(72% 0.08 240)
    infoBg = Color(0xFF1C2B35), // oklch(28% 0.028 240)
    onAccent = Color(0xFF001925), // oklch(20% 0.04 230)
    accent9 = Color(0xFF4FB2B2), // mix accent 9% + surface
    accent8t = Color(0x1453C2C1), // accent @ 8% alpha
    accent11 = Color(0xFF4DAEAE), // mix accent 11% + surface
    accent45 = Color(0x7353C2C1), // accent @ 45% alpha
    warn6 = Color(0x0FCAAE63), // warn @ 6% alpha
    warn40 = Color(0x66CAAE63), // warn @ 40% alpha
    danger12 = Color(0xFFBB716B), // mix danger 12% + surface
    danger32 = Color(0x52D47C76), // danger @ 32% alpha
    chromeBg = Color(0xD1182125), // surface @ 82% alpha
    focusRing = Color(0x6B53C2C1), // accent @ 42% alpha
)

/** 雪青（冷浅色） */
val FrostPalette = NovaPalette(
    bg = Color(0xFFF4F7F9), // oklch(97.4% 0.004 240)
    surface = Color(0xFFFCFEFF), // oklch(99.5% 0.002 240)
    surface2 = Color(0xFFEDF1F3), // oklch(95.6% 0.005 234)
    fg = Color(0xFF272B34), // oklch(29% 0.016 262)
    muted = Color(0xFF5E646B), // oklch(50% 0.014 256)
    faint = Color(0xFF787E84), // oklch(59% 0.012 254)
    border = Color(0xFFE0E4E6), // oklch(91.6% 0.005 240)
    borderStrong = Color(0xFFCAD0D4), // oklch(85.4% 0.009 240)
    orange = Color(0xFF72AECB), // oklch(72% 0.075 230)
    accent = Color(0xFF4868A2), // oklch(52% 0.1 262)
    red = Color(0xFF6965A6), // oklch(54% 0.1 285)
    accentInk = Color(0xFF365184), // oklch(44% 0.09 262)
    success = Color(0xFF467558), // oklch(52% 0.07 156)
    successBg = Color(0xFFEFF7F1), // oklch(96.8% 0.011 156)
    warn = Color(0xFF907649), // oklch(58% 0.07 80)
    warnBg = Color(0xFFF7F4EC), // oklch(96.7% 0.011 86)
    danger = Color(0xFF926056), // oklch(54% 0.068 32)
    dangerBg = Color(0xFFFAF2F0), // oklch(96.7% 0.009 33)
    info = Color(0xFF51738C), // oklch(54% 0.055 240)
    infoBg = Color(0xFFF0F5F9), // oklch(96.8% 0.008 240)
    onAccent = Color(0xFFFFFFFF), // #fff
    accent9 = Color(0xFF5775AB), // mix accent 9% + surface
    accent8t = Color(0x144868A2), // accent @ 8% alpha
    accent11 = Color(0xFF5B78AD), // mix accent 11% + surface
    accent45 = Color(0x734868A2), // accent @ 45% alpha
    warn6 = Color(0x0F907649), // warn @ 6% alpha
    warn40 = Color(0x66907649), // warn @ 40% alpha
    danger12 = Color(0xFF9F7268), // mix danger 12% + surface
    danger32 = Color(0x52926056), // danger @ 32% alpha
    chromeBg = Color(0xD1FCFEFF), // surface @ 82% alpha
    focusRing = Color(0x6B4868A2), // accent @ 42% alpha
)

/** grad-warn-text 停点（主题无关）: oklch(82% 0.055 85) */
val warnText1 = Color(0xFFD5C29C)

/** grad-warn-text 停点（主题无关）: oklch(59% 0.07 80) */
val warnText2 = Color(0xFF93794C)

/** grad-warn-text 停点（主题无关）: oklch(68% 0.07 75) */
val warnText3 = Color(0xFFB29267)

val NovaThemePalettes = listOf(PaperPalette, InkPalette, CeladonPalette, FrostPalette)
