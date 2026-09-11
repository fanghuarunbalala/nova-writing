plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    // :app 用；在根声明 apply false 使 kotlin.android 随已知版本上类路径，
    // 否则与 kotlin.jvm 载入的 kotlin-gradle-plugin 冲突（unknown version）
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
