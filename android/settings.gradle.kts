rootProject.name = "de-enshittify-discord-patches"

pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        // Morphe publishes its Gradle plugin and patcher on GitHub Packages, which needs a GitHub token
        // with read:packages even for public packages: the gpr.user/gpr.key Gradle properties, or the
        // GITHUB_ACTOR/GITHUB_TOKEN environment variables (build.sh passes `gh auth token`).
        maven {
            name = "GitHubPackages"
            url = uri("https://maven.pkg.github.com/MorpheApp/registry")
            credentials {
                username = providers.gradleProperty("gpr.user").orNull ?: System.getenv("GITHUB_ACTOR")
                password = providers.gradleProperty("gpr.key").orNull ?: System.getenv("GITHUB_TOKEN")
            }
        }
        maven { url = uri("https://jitpack.io") }
    }
}

plugins {
    id("app.morphe.patches") version "2.1.1"
}
