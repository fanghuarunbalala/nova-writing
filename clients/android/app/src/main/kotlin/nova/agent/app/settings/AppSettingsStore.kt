package nova.agent.app.settings

import android.content.Context
import androidx.datastore.preferences.core.byteArrayPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import nova.agent.app.security.TokenCipher

private val Context.settingsDataStore by preferencesDataStore(name = "nova_settings")

/** 数据源开关（PRD FR11）：debug 可切回演示模式，重启生效（容器按开关构造）。 */
enum class DataSource { REAL, DEMO }

/** BYOK Provider 配置（FR9）。 */
data class ByokConfig(val baseUrl: String, val apiKey: String, val model: String) {
    val configured: Boolean get() = baseUrl.isNotBlank() && apiKey.isNotBlank() && model.isNotBlank()
}

/**
 * 全局设置持久化（DataStore Preferences，独立于主题的 nova_theme）：
 * server_url / BYOK 三件（api_key 经 [TokenCipher] 加密，别名独立于令牌）/ 数据源开关。
 */
class AppSettingsStore(
    private val context: Context,
    /** BYOK 密钥加解密器（AppContainer 注入 KeystoreTokenCipher(BYOK_ALIAS)；测试可注入假实现）。 */
    private val byokCipher: TokenCipher? = null,
) {

    val serverUrl: Flow<String> = context.settingsDataStore.data.map { it[SERVER_URL] ?: "" }

    suspend fun setServerUrl(url: String) {
        context.settingsDataStore.edit { it[SERVER_URL] = url.trim().trimEnd('/') }
    }

    val providerBaseUrl: Flow<String> = context.settingsDataStore.data.map { it[PROVIDER_URL] ?: "" }
    val providerModel: Flow<String> = context.settingsDataStore.data.map { it[PROVIDER_MODEL] ?: "" }

    suspend fun setByok(baseUrl: String, apiKey: String, model: String) {
        context.settingsDataStore.edit { prefs ->
            prefs[PROVIDER_URL] = baseUrl.trim().trimEnd('/')
            prefs[PROVIDER_MODEL] = model.trim()
            if (apiKey.isBlank()) {
                prefs.remove(PROVIDER_KEY)
            } else {
                val cipher = byokCipher ?: return@edit
                prefs[PROVIDER_KEY] = cipher.encrypt(apiKey.toByteArray())
            }
        }
    }

    /** 三件齐备才视为已配置（apiKey 解密失败视为未配置）。 */
    suspend fun byokConfig(): ByokConfig? = decodeByok(context.settingsDataStore.data.first())

    val byok: Flow<ByokConfig?> = context.settingsDataStore.data.map(::decodeByok)

    private fun decodeByok(prefs: androidx.datastore.preferences.core.Preferences): ByokConfig? {
        val url = prefs[PROVIDER_URL]?.trim().orEmpty()
        val model = prefs[PROVIDER_MODEL]?.trim().orEmpty()
        if (url.isBlank() || model.isBlank()) return null
        val blob = prefs[PROVIDER_KEY] ?: return null
        val cipher = byokCipher ?: return null
        val key = runCatching { String(cipher.decrypt(blob)) }.getOrNull() ?: return null
        if (key.isBlank()) return null
        return ByokConfig(baseUrl = url, apiKey = key, model = model)
    }

    val dataSource: Flow<DataSource> = context.settingsDataStore.data.map {
        it[DATA_SOURCE]?.let { stored -> DataSource.entries.firstOrNull { e -> e.name == stored } } ?: DataSource.REAL
    }

    suspend fun setDataSource(source: DataSource) {
        context.settingsDataStore.edit { it[DATA_SOURCE] = source.name }
    }

    /** 启动期同步读一次（NovaApplication 选图；runBlocking 单键极小 IO）。 */
    fun dataSourceBlocking(): DataSource = runBlocking { dataSource.first() }

    private companion object {
        val SERVER_URL = stringPreferencesKey("server_url")
        val PROVIDER_URL = stringPreferencesKey("provider_base_url")
        val PROVIDER_KEY = byteArrayPreferencesKey("provider_api_key")
        val PROVIDER_MODEL = stringPreferencesKey("provider_model")
        val DATA_SOURCE = stringPreferencesKey("data_source")
    }
}
