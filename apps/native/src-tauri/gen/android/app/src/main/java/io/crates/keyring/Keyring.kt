package io.crates.keyring

import android.content.Context

/**
 * Hands the Android application context to the Rust credential store.
 *
 * `android-native-keyring-store` reaches the Android Keystore through
 * `ndk_context`, which nothing in Tauri (tao 0.35) initialises; without this
 * the store panics with "android context was not initialized".
 *
 * The JNI symbol this binds to is already exported from the app's own library,
 * because the crate is linked into it — so there is no second `.so` to ship,
 * only this declaration. `loadLibrary` is idempotent and makes the call safe
 * regardless of whether `Rust.kt` has been touched yet.
 */
class Keyring {
    companion object {
        init {
            System.loadLibrary("bitcoin_wallet_app_lib")
        }

        external fun initializeNdkContext(context: Context)
    }
}
