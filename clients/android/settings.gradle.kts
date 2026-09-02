pluginManagement {
    repositories {
        // 国内镜像优先，官方源兜底
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        maven("https://maven.aliyun.com/repository/public")
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://maven.aliyun.com/repository/public")
        maven("https://maven.aliyun.com/repository/google")
        mavenCentral()
    }
}

rootProject.name = "nova-android"

include(":core:model")
include(":core:provider")
include(":core:runtime")
include(":core:data")
