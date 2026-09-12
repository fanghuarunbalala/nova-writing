import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "nova.agent.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "nova.agent.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.3.0-stage3"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // 阶段3 真实数据接线：runtime（LoopEvent 等类型契约）+ net（auth/lease/journal/SSE）+ data（Room）
    implementation(project(":core:runtime"))
    implementation(project(":core:net"))
    implementation(project(":core:data"))
    // :core:data 对 room-runtime 是 implementation 不传递；:app 侧 databaseBuilder 需显式引入
    implementation(libs.room.runtime)
    // :core:net 对 okhttp 是 implementation 不传递；:app 构造 ServerHttp/Provider 默认客户端需显式引入
    implementation(libs.okhttp)
    implementation(libs.serialization.json)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.compose.icons.extended)
    implementation(libs.compose.foundation)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.datastore.preferences)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.mockwebserver)
    testRuntimeOnly(libs.junit.launcher)
    // 截图基线（Roborazzi/Robolectric）阶段5引入：本机 RNG 渲染损坏（PRD 阶段2 实现备注）
}

tasks.withType<Test> {
    useJUnitPlatform()
}
