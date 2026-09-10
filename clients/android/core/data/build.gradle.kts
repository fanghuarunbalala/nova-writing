plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    api(project(":core:runtime"))
    implementation(libs.coroutines.core)
    implementation(libs.serialization.json)
    implementation(libs.room.runtime)
    ksp(libs.room.compiler)
    // Room KMP JVM 路径：捆绑 SQLite 驱动（测试内存库 + JVM 运行；Android 设备用框架驱动）
    implementation(libs.sqlite.bundled)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.coroutines.test)
    testRuntimeOnly(libs.junit.launcher)
}

tasks.withType<Test> {
    useJUnitPlatform()
}
