plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    api(project(":core:model"))
    api(project(":core:provider"))
    implementation(libs.coroutines.core)
    implementation(libs.serialization.json)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.turbine)
    testRuntimeOnly(libs.junit.launcher)
}

tasks.withType<Test> {
    useJUnitPlatform()
}

tasks.register<JavaExec>("runDemo") {
    group = "demo"
    description = "端到端演示：流式打字机 + 审批 + 崩溃恢复（脚本化假模型，不触网）"
    mainClass.set("nova.agent.demo.DemoMainKt")
    classpath = sourceSets["main"].runtimeClasspath
}
