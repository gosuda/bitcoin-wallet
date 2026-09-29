# Rules for the release build, which R8 shrinks and obfuscates
# (isMinifyEnabled in build.gradle.kts).
#
# Nothing here keeps a class. What Rust and the webview reach by name is
# already kept: the default optimize rules keep every class with a native
# method under its own name (io.crates.keyring.Keyring$Companion among them),
# wry's generated proguard-wry.pro keeps the webview glue, and Tauri and each
# plugin ship consumer rules for their @Command methods.

# Keep line numbers in stack traces. R8's mapping file turns a release trace
# back into source, and the .aab carries that file to Play Console.
-keepattributes SourceFile,LineNumberTable
