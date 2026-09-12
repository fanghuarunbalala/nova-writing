package nova.agent.app.ui.theme

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.themeDataStore by preferencesDataStore(name = "nova_theme")

/** 主题偏好持久化（DataStore Preferences）；阶段3起同文件扩为全局设置 */
class ThemeStore(private val context: Context) {

    val theme: Flow<NovaThemeKind> = context.themeDataStore.data.map { prefs ->
        prefs[KEY]?.let { stored ->
            NovaThemeKind.entries.firstOrNull { it.name == stored }
        } ?: NovaThemeKind.PAPER
    }

    suspend fun setTheme(theme: NovaThemeKind) {
        context.themeDataStore.edit { it[KEY] = theme.name }
    }

    private companion object {
        val KEY = stringPreferencesKey("theme")
    }
}
