package app.deenshittify.discord

import app.morphe.patcher.patch.ApkFileType
import app.morphe.patcher.patch.AppTarget
import app.morphe.patcher.patch.Compatibility

internal const val DISCORD_PACKAGE = "com.discord"

/**
 * Discord for Android, as Morphe Manager should fetch it: the split bundle (APKM) from APKMirror, signed with
 * Discord's own certificate (Manager refuses an APK with another signature).
 *
 * The patches don't depend on a particular Discord version, so any version is declared. That is also what
 * gets Manager a direct APKMirror link: Morphe's download lookup can't match Discord's version names
 * ("354.12 - Stable") and falls back to a web search, while "any version" leads to the newest stable release.
 * Last checked against 354.12 - Stable.
 */
internal val DISCORD = Compatibility(
    packageName = DISCORD_PACKAGE,
    name = "Discord",
    apkFileType = ApkFileType.APKM,
    appIconColor = 0x5865F2,
    signatures = setOf("3c39d23cf9367849a5c699395647fe0e5bfea5a1f1f40d8c717ddc70f8bfa113"),
    targets = listOf(AppTarget(version = null)),
)
