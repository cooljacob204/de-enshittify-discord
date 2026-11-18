package app.deenshittify.discord

import app.morphe.patcher.patch.PatchException
import com.android.tools.smali.dexlib2.Opcodes
import com.android.tools.smali.dexlib2.writer.builder.DexBuilder
import com.android.tools.smali.dexlib2.writer.io.MemoryDataStore
import com.android.tools.smali.smali.smaliFlexLexer
import com.android.tools.smali.smali.smaliParser
import com.android.tools.smali.smali.smaliTreeWalker
import org.antlr.runtime.CommonTokenStream
import org.antlr.runtime.TokenSource
import org.antlr.runtime.tree.CommonTreeNodeStream
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.io.StringReader

// The classes these patches add to Discord are small enough to write in smali, so they're assembled when
// patching, into a DEX file the patcher merges into the app (an "extension"), instead of being built with
// the Android SDK. That also lets them embed values only known then (the script, the chosen package name).

/** Assembles smali classes into a DEX file. */
internal fun dexOf(vararg classes: String): InputStream {
    val builder = DexBuilder(Opcodes.getDefault())
    for (smali in classes) {
        val lexer = smaliFlexLexer(StringReader(smali), 15)
        val tokens = CommonTokenStream(lexer as TokenSource)
        val parser = smaliParser(tokens)
        val tree = parser.smali_file()
        if (lexer.numberOfSyntaxErrors > 0 || parser.numberOfSyntaxErrors > 0) {
            throw PatchException("An added class doesn't assemble:\n${smali.lineSequence().first()}")
        }
        val walker = smaliTreeWalker(CommonTreeNodeStream(tree.tree).apply { tokenStream = tokens })
        walker.setDexBuilder(builder)
        walker.smali_file()
    }
    val store = MemoryDataStore()
    builder.writeTo(store)
    return ByteArrayInputStream(store.buffer, 0, store.size)
}

/** Escapes text for a smali string literal. */
internal fun smaliString(text: String) = buildString {
    for (c in text) {
        when {
            c == '\\' -> append("\\\\")
            c == '"' -> append("\\\"")
            c == '\n' -> append("\\n")
            c == '\r' -> append("\\r")
            c == '\t' -> append("\\t")
            c.code in 0x20..0x7e -> append(c)
            else -> append("\\u%04x".format(c.code))
        }
    }
}
