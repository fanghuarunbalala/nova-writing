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

// 双端共享夹具单一来源：从仓库根 protocol/fixtures 同步到测试资源
// （取代此前手工 cp core 侧生成的 golden/parity 夹具——TS 侧 WRITE_FIXTURE/WRITE_PARITY 重生成后此处自动跟进）
val syncProtocolFixtures by tasks.registering(Sync::class) {
    // Gradle 根是 clients/android，protocol/ 在仓库根（再上两级）
    from(rootProject.file("../../protocol/fixtures")) {
        include("definition-*.json", "parity-*.json")
    }
    into(layout.projectDirectory.dir("src/test/resources"))
}

tasks.named("processTestResources") {
    dependsOn(syncProtocolFixtures)
}

tasks.register<JavaExec>("runDemo") {
    group = "demo"
    description = "端到端演示：流式打字机 + 审批 + 崩溃恢复（脚本化假模型，不触网）"
    mainClass.set("nova.agent.demo.DemoMainKt")
    classpath = sourceSets["main"].runtimeClasspath
}
