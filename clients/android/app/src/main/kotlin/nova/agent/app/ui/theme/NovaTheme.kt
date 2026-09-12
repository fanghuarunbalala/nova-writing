package nova.agent.app.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

enum class NovaThemeKind(val label: String, val isLight: Boolean) {
    PAPER("宣纸白", true),
    INK("墨夜", false),
    CELADON("黛青", false),
    FROST("雪青", true);

    val palette: NovaPalette
        get() = when (this) {
            PAPER -> PaperPalette
            INK -> InkPalette
            CELADON -> CeladonPalette
            FROST -> FrostPalette
        }
}

/** 语义扩展色（success/warn/info、渐变停点等 ColorScheme 装不下的 token） */
val LocalNovaPalette = staticCompositionLocalOf { PaperPalette }

fun NovaPalette.toColorScheme(isLight: Boolean): ColorScheme {
    val base = if (isLight) {
        lightColorScheme(
            primary = accent, onPrimary = onAccent,
            background = bg, onBackground = fg,
            surface = surface, onSurface = fg,
            surfaceVariant = surface2, onSurfaceVariant = muted,
            outline = borderStrong, outlineVariant = border,
            error = danger, onError = onAccent,
            secondary = accentInk, onSecondary = onAccent,
            tertiary = orange, onTertiary = onAccent,
        )
    } else {
        darkColorScheme(
            primary = accent, onPrimary = onAccent,
            background = bg, onBackground = fg,
            surface = surface, onSurface = fg,
            surfaceVariant = surface2, onSurfaceVariant = muted,
            outline = borderStrong, outlineVariant = border,
            error = danger, onError = onAccent,
            secondary = accentInk, onSecondary = onAccent,
            tertiary = orange, onTertiary = onAccent,
        )
    }
    return base
}

/** 品牌渐变（demo --grad-accent：orange→accent→red） */
fun NovaPalette.brandBrush(): Brush = Brush.linearGradient(listOf(orange, accent, red))

/** 审批等待渐变文字（demo --grad-warn-text，主题无关） */
fun warnTextBrush(): Brush = Brush.linearGradient(listOf(warnText1, warnText2, warnText3))

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
fun NovaTheme(theme: NovaThemeKind = NovaThemeKind.PAPER, content: @Composable () -> Unit) {
    val palette = theme.palette
    val scheme = remember(theme) { palette.toColorScheme(theme.isLight) }

    // 状态栏/导航栏图标明暗随主题切（框架层，styles.xml 只留了透明系统栏）
    val view = LocalView.current
    LaunchedEffect(theme.isLight) {
        view.context.findActivity()?.window?.let { window ->
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = theme.isLight
            controller.isAppearanceLightNavigationBars = theme.isLight
        }
    }

    CompositionLocalProvider(LocalNovaPalette provides palette) {
        MaterialTheme(colorScheme = scheme, typography = NovaTypography, content = content)
    }
}
