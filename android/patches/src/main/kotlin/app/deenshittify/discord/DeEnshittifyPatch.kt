package app.deenshittify.discord

import app.morphe.patcher.extensions.InstructionExtensions.addInstructions
import app.morphe.patcher.patch.PatchException
import app.morphe.patcher.patch.booleanOption
import app.morphe.patcher.patch.mutableClassDefBy
import app.morphe.patcher.patch.patch

// Discord's code is a Hermes bytecode bundle that React Native loads through a JSBundleLoader: the asset
// loader for the bundle shipped in the APK, and the file loader for a bundle Discord downloaded over the
// air. This patch makes both run our script (plain JS, compiled by Hermes at load time) on the same JS
// runtime right before Discord's bundle. The script then patches Discord's modules as they load.
//
// The script is embedded in an added class, which writes it to the app's private files folder and hands
// that file to React Native, so no file has to be added to the APK.

private const val SCRIPT = "de-enshittify-discord.js"

private const val LOADER = "Lcom/facebook/react/bridge/JSBundleLoader\$Companion"
private const val ASSET_LOADER = "$LOADER\$createAssetLoader\$1;"
private const val FILE_LOADER = "$LOADER\$createFileLoader\$1;"
private const val DELEGATE = "Lcom/facebook/react/bridge/JSBundleLoaderDelegate;"
private const val SCRIPT_LOADER = "Lapp/deenshittify/discord/ScriptLoader;"
private const val LOAD = "$SCRIPT_LOADER->load(Landroid/content/Context;${DELEGATE}Z)V"

@Suppress("unused")
val deEnshittifyPatch = patch(
    name = "De-enshittify",
    description = "Removes Quests, the Shop and ad popups.",
) {
    compatibleWith(DISCORD)

    val hideNitroUpsells by booleanOption(
        key = "hideNitroUpsells",
        default = true,
        title = "Hide Nitro upsells",
        description = "Also treat popups promoting Nitro, Nitro-only features, boosts and paid server " +
            "subscriptions as dismissed. Notices about your own subscription are kept.",
    )

    extendWith {
        val script = DeEnshittifyPatch::class.java.getResourceAsStream("/$SCRIPT")
            ?.use { it.readBytes().toString(Charsets.UTF_8) }
            ?: throw PatchException("$SCRIPT is missing from the patches file")
        // The script reads its options from this global.
        val options = "globalThis.__deEnshittifyDiscordOptions = { hideNitroUpsells: ${hideNitroUpsells != false} };\n"
        dexOf(scriptLoaderClass(options + script))
    }

    execute {
        // Both loaders are anonymous classes with a `loadScript(delegate)` method that has three free
        // registers (v0-v2) before its own code runs; p0 is the loader, p1 the delegate. Their captured
        // fields are looked up by type, since their names are compiler-generated.
        val assetLoader = mutableClassDefBy(ASSET_LOADER)
        val context = assetLoader.fields.single { it.type == "Landroid/content/Context;" }.name
        val assetSync = assetLoader.fields.single { it.type == "Z" }.name
        assetLoader.methods.single { it.name == "loadScript" }.addInstructions(
            0,
            """
                iget-object v0, p0, $ASSET_LOADER->$context:Landroid/content/Context;
                iget-boolean v1, p0, $ASSET_LOADER->$assetSync:Z
                invoke-static {v0, p1, v1}, $LOAD
            """,
        )

        // The file loader has no Context; ScriptLoader then uses the application's.
        val fileLoader = mutableClassDefBy(FILE_LOADER)
        val fileSync = fileLoader.fields.single { it.type == "Z" }.name
        fileLoader.methods.single { it.name == "loadScript" }.addInstructions(
            0,
            """
                const/4 v0, 0x0
                iget-boolean v1, p0, $FILE_LOADER->$fileSync:Z
                invoke-static {v0, p1, v1}, $LOAD
            """,
        )
    }
}

/**
 * ScriptLoader.load(context, delegate, loadSynchronously) writes the script to the app's private files
 * folder and has React Native run it. Without a context it takes the application's
 * (ActivityThread.currentApplication is a non-SDK API that apps are allowed to call). Any failure is
 * logged and Discord loads without the patch.
 */
private fun scriptLoaderClass(script: String) =
    """
    .class public final $SCRIPT_LOADER
    .super Ljava/lang/Object;

    .method public static load(Landroid/content/Context;${DELEGATE}Z)V
        .registers 6
        :try_start
        if-nez p0, :have_context
        invoke-static {}, Landroid/app/ActivityThread;->currentApplication()Landroid/app/Application;
        move-result-object p0
        if-eqz p0, :done
        :have_context
        new-instance v0, Ljava/io/File;
        invoke-virtual {p0}, Landroid/content/Context;->getFilesDir()Ljava/io/File;
        move-result-object v1
        const-string v2, "$SCRIPT"
        invoke-direct {v0, v1, v2}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V
        const-string v1, "${smaliString(script)}"
        const-string v2, "UTF-8"
        invoke-virtual {v1, v2}, Ljava/lang/String;->getBytes(Ljava/lang/String;)[B
        move-result-object v1
        new-instance v2, Ljava/io/FileOutputStream;
        invoke-direct {v2, v0}, Ljava/io/FileOutputStream;-><init>(Ljava/io/File;)V
        invoke-virtual {v2, v1}, Ljava/io/FileOutputStream;->write([B)V
        invoke-virtual {v2}, Ljava/io/FileOutputStream;->close()V
        invoke-virtual {v0}, Ljava/io/File;->getAbsolutePath()Ljava/lang/String;
        move-result-object v0
        invoke-interface {p1, v0, v0, p2}, $DELEGATE->loadScriptFromFile(Ljava/lang/String;Ljava/lang/String;Z)V
        :try_end
        .catch Ljava/lang/Throwable; {:try_start .. :try_end} :failed
        :done
        return-void
        :failed
        move-exception v0
        const-string v1, "de-enshittify-discord"
        const-string v2, "Couldn't load the patch script; Discord runs unpatched"
        invoke-static {v1, v2, v0}, Landroid/util/Log;->w(Ljava/lang/String;Ljava/lang/String;Ljava/lang/Throwable;)I
        return-void
    .end method
    """.trimIndent()

private object DeEnshittifyPatch
