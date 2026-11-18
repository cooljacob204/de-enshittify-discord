package app.deenshittify.discord

import app.morphe.patcher.Fingerprint
import app.morphe.patcher.extensions.InstructionExtensions.getInstruction
import app.morphe.patcher.extensions.InstructionExtensions.replaceInstruction
import app.morphe.patcher.methodCall
import app.morphe.patcher.patch.patch
import app.morphe.patcher.patch.resourceXml
import app.morphe.patcher.patch.stringOption
import app.morphe.patcher.util.matchAllMethodIndicesForEach
import com.android.tools.smali.dexlib2.iface.instruction.FiveRegisterInstruction
import com.android.tools.smali.dexlib2.iface.instruction.RegisterRangeInstruction

// Like Morphe's and ReVanced's YouTube patches, the patched app gets its own package name so it installs
// next to the official Discord instead of replacing it, and its own name on the home screen.
//
// Only the manifest is changed. Everything in it that must be unique per device is renamed too: content
// provider authorities and the permissions Discord defines. Discord's resource table keeps the name
// com.discord, so code that looks up its own resources by the app's (new) package name, as Discord's
// images and Firebase (push notifications) do, would find nothing; every such lookup goes through
// ResourceNames.getIdentifier, which retries it under com.discord.

private const val RESOURCE_NAMES = "Lapp/deenshittify/discord/ResourceNames;"
private const val GET_IDENTIFIER = "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)I"

private object GetIdentifierFingerprint : Fingerprint(
    filters = listOf(methodCall(smali = "Landroid/content/res/Resources;->getIdentifier$GET_IDENTIFIER")),
)

@Suppress("unused")
val packageNamePatch = patch(
    name = "Change package name",
    description = "Installs the patched Discord next to the official one instead of replacing it.",
) {
    compatibleWith(DISCORD)

    // Not keyed "packageName": Morphe Manager files a build from a patch with that option as a clone the
    // user asked for, listed apart from the app. This rename is what lets the patched app sit next
    // to the official one, like Morphe's YouTube builds, so it's the app's own install.
    val packageName by stringOption(
        key = "patchedPackageName",
        default = "app.deenshittify.discord",
        title = "Package name",
        description = "The patched app's package name. It must differ from $DISCORD_PACKAGE.",
        required = true,
    ) { it != null && it != DISCORD_PACKAGE && Regex("""[a-zA-Z]\w*(\.[a-zA-Z]\w*)+""").matches(it) }

    val appName by stringOption(
        key = "appName",
        default = "Discord Renewed",
        title = "App name",
        description = "The name shown under the app icon.",
        required = true,
    ) { !it.isNullOrBlank() }

    extendWith { dexOf(resourceNamesClass(packageName!!)) }

    execute {
        val newName = packageName!!
        fun renamed(value: String) =
            if (value == DISCORD_PACKAGE || value.startsWith("$DISCORD_PACKAGE.")) {
                newName + value.removePrefix(DISCORD_PACKAGE)
            } else {
                value
            }

        resourceXml("AndroidManifest.xml").use { manifest ->
            manifest.root.setAttribute("package", newName)
            for (provider in manifest.elements("provider")) {
                val authorities = provider.attribute("android:authorities") ?: continue
                provider.setAttribute("android:authorities", authorities.split(";").joinToString(";", transform = ::renamed))
            }
            for (tag in listOf("permission", "uses-permission")) {
                for (permission in manifest.elements(tag)) {
                    val name = permission.attribute("android:name") ?: continue
                    permission.setAttribute("android:name", renamed(name))
                }
            }
            // The launcher shows the launcher activity's label (Discord's main activity has its own,
            // which its icon aliases inherit), so rename every label, not just the application's.
            for (tag in listOf("application", "activity", "activity-alias")) {
                for (element in manifest.elements(tag)) {
                    val launcher = element.elements("category").any {
                        it.attribute("android:name") == "android.intent.category.LAUNCHER"
                    }
                    if (tag == "application" || element.hasAttribute("android:label") || launcher) {
                        element.setAttribute("android:label", appName!!)
                    }
                }
            }
        }

        // Resources.getIdentifier(name, type, package) -> ResourceNames.getIdentifier(resources, name,
        // type, package), with the same registers.
        GetIdentifierFingerprint.matchAllMethodIndicesForEach { index ->
            if (definingClass == RESOURCE_NAMES) return@matchAllMethodIndicesForEach
            when (val call = getInstruction(index)) {
                is FiveRegisterInstruction -> replaceInstruction(
                    index,
                    "invoke-static {v${call.registerC}, v${call.registerD}, v${call.registerE}, v${call.registerF}}, " +
                        "$RESOURCE_NAMES->getIdentifier(Landroid/content/res/Resources;${GET_IDENTIFIER.removePrefix("(")}",
                )
                is RegisterRangeInstruction -> replaceInstruction(
                    index,
                    "invoke-static/range {v${call.startRegister} .. v${call.startRegister + 3}}, " +
                        "$RESOURCE_NAMES->getIdentifier(Landroid/content/res/Resources;${GET_IDENTIFIER.removePrefix("(")}",
                )
            }
        }
    }
}

/**
 * ResourceNames.getIdentifier(resources, name, type, package): Resources.getIdentifier, retried under the
 * other of the two package names (the app's and com.discord) when it finds nothing.
 */
private fun resourceNamesClass(packageName: String) =
    """
    .class public final $RESOURCE_NAMES
    .super Ljava/lang/Object;

    .method public static getIdentifier(Landroid/content/res/Resources;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)I
        .registers 6
        invoke-virtual {p0, p1, p2, p3}, Landroid/content/res/Resources;->getIdentifier$GET_IDENTIFIER
        move-result v0
        if-nez v0, :done
        const-string v1, "${smaliString(packageName)}"
        invoke-virtual {v1, p3}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
        move-result v1
        if-eqz v1, :not_ours
        const-string v1, "$DISCORD_PACKAGE"
        goto :retry
        :not_ours
        const-string v1, "$DISCORD_PACKAGE"
        invoke-virtual {v1, p3}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
        move-result v1
        if-eqz v1, :done
        const-string v1, "${smaliString(packageName)}"
        :retry
        invoke-virtual {p0, p1, p2, v1}, Landroid/content/res/Resources;->getIdentifier$GET_IDENTIFIER
        move-result v0
        :done
        return v0
    .end method
    """.trimIndent()
